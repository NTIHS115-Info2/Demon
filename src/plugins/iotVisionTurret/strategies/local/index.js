const path = require('path');
const fs = require('fs');
const express = require('express');
const fetch = require('node-fetch');
const Logger = require('../../../../utils/logger');
const { log } = require('console');

// iotVisionTurret 本地策略（Roboflow workflow + IR v2 + scan/track）

const logger = new Logger('iotVisionTurret');

// ───────────────────────────────────────────────
// 模組層級狀態（single device, single job）
// ───────────────────────────────────────────────

// 待送指令佇列（每筆含 jobId；避免失敗工作殘留指令在下一次被拉走）
const pendingCommands = [];

// /iot/pull 長輪詢等待者（每筆保存 res，以便 reset/offline 時能主動結束連線）
const pendingPullWaiters = [];

// 影像等待者：image_id -> { resolve, reject, timer }
const imageWaiters = new Map();

// 影像索引：image_id -> { filePath, createdAt }
const imageStore = new Map();

// 裝置註冊狀態
let currentDeviceId = null;
let deviceOnline = false;

// 單工作鎖
let jobLock = false;
let currentJobId = null;

// 路由註冊
let routesRegistered = false;
let registeredAppRef = null;
const ROUTES_INSTALLED_FLAG = '__iotVisionTurretRoutesInstalled';

// 上傳檔案儲存目錄
const UPLOAD_DIR = path.resolve(process.cwd(), 'artifacts', 'iotVisionTurret');

// 是否上傳後刪除影像檔案
const deleteImage = false;

// ───────────────────────────────────────────────
// 參數（可由 env 覆寫）
// ───────────────────────────────────────────────

const priority = 50;

const LONG_POLL_TIMEOUT_MS = Number(process.env.IOT_LONG_POLL_TIMEOUT_MS || 25000);
const TASK_TIMEOUT_MS = Number(process.env.IOT_TASK_TIMEOUT_MS || 300000);
const UPLOAD_TIMEOUT_MS = Number(process.env.IOT_UPLOAD_TIMEOUT_MS || 10_000);
const UPLOAD_RESOLVE_DEBOUNCE_MS = Number(process.env.IOT_UPLOAD_RESOLVE_DEBOUNCE_MS || 20);

const MAX_IMAGE_BYTES = Number(process.env.IOT_MAX_IMAGE_BYTES || 20 * 1024 * 1024);
const IMAGE_TTL_MS = Number(process.env.IOT_IMAGE_TTL_MS || 60_000);
const MAX_IMAGE_STORE_ENTRIES = Number(process.env.IOT_MAX_IMAGE_STORE_ENTRIES || 64);

// 掃描/追蹤參數
const SCAN_PITCH_LIST = [0 , 45 , 135 , 180];
const SCAN_YAW_LIST = [0, 45, 90, 135, 180];
const TRACK_MAX_STEPS = Number(process.env.IOT_TRACK_MAX_STEPS || 6);

function readEnvPositiveNumber(name, fallback) {
  const raw = process.env[name];
  const v = Number(raw);
  return (Number.isFinite(v) && v > 0) ? v : fallback;
}

// 注意：不要用 `Number(env || fallback)`；因為 env="0" 是 truthy，會導致 tolerance=0，追蹤永遠不會鎖定。
const TRACK_PIXEL_TOLERANCE = readEnvPositiveNumber('IOT_TRACK_PIXEL_TOLERANCE', 40);

// 視角（用於像素偏移 -> 角度步進 的粗估）
const CAMERA_H_FOV_DEG = Number(process.env.IOT_CAMERA_H_FOV_DEG || 70);
const CAMERA_V_FOV_DEG = Number(process.env.IOT_CAMERA_V_FOV_DEG || 50);
const TRACK_MOVE_GAIN = Number(process.env.IOT_TRACK_MOVE_GAIN || 0.9);
const MAX_STEP_DEG = Number(process.env.IOT_MAX_STEP_DEG || 18);

// 伺服馬達角度限制
const YAW_MIN = 0;
const YAW_MAX = 180;
const PITCH_MIN = 0; // 非談判：垂直軸不能往下
const PITCH_MAX = 180;

// 追蹤方向修正（不同機構可用 env 翻轉符號）
// 1 代表維持目前公式；-1 代表反向
const YAW_DIR = Number(process.env.IOT_YAW_DIR || 1) === -1 ? -1 : 1;
const PITCH_DIR = Number(process.env.IOT_PITCH_DIR || 1) === -1 ? -1 : 1;

// Roboflow workflow（本地推理）
const DEFAULT_ROBOFLOW_BASE_URL = 'http://127.0.0.1:9001';
const DEFAULT_ROBOFLOW_TIMEOUT_MS = 8000;
const DEFAULT_ROBOFLOW_MAX_RESPONSE_BYTES = 1 * 1024 * 1024 * 1024;
const DEFAULT_ROBOFLOW_MAX_RESPONSE_RAM_BYTES = 10 * 1024 * 1024 * 1024;

// IR 指令字典（請你之後把實際碼填上）
const IR_CODE_DICT = Object.freeze({
  light: Object.freeze({
    turn_on: '0x000000',
    turn_off: '0x000001'
  }),
  fan: Object.freeze({
    turn_on: '0x000010',
    turn_off: '0x000011'
  })
});

// ───────────────────────────────────────────────
// 小工具
// ───────────────────────────────────────────────

function readEnvString(name, fallback) {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

function readEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function resolveRoboflowConfig(options = {}) {
  const overrides = options?.roboflow || {};
  const envConfig = {
    baseUrl: readEnvString('ROBOFLOW_HOST', DEFAULT_ROBOFLOW_BASE_URL),
    apiKey: readEnvString('ROBOFLOW_API_KEY', ''),
    workspace: readEnvString('ROBOFLOW_WORKSPACE', ''),
    workflowId: readEnvString('ROBOFLOW_WORKFLOW_ID', ''),
    targetClass: readEnvString('ROBOFLOW_TARGET_CLASS', ''),
    timeoutMs: readEnvNumber('ROBOFLOW_TIMEOUT_MS', DEFAULT_ROBOFLOW_TIMEOUT_MS),
    maxResponseBytes: readEnvNumber('ROBOFLOW_MAX_RESPONSE_BYTES', DEFAULT_ROBOFLOW_MAX_RESPONSE_BYTES),
    maxResponseRamBytes: readEnvNumber(
      'ROBOFLOW_MAX_RESPONSE_RAM_BYTES',
      DEFAULT_ROBOFLOW_MAX_RESPONSE_RAM_BYTES
    )
  };

  const resolved = {
    baseUrl: overrides.baseUrl ?? envConfig.baseUrl,
    apiKey: overrides.apiKey ?? envConfig.apiKey,
    workspace: overrides.workspace ?? envConfig.workspace,
    workflowId: overrides.workflowId ?? envConfig.workflowId,
    targetClass: overrides.targetClass ?? envConfig.targetClass,
    timeoutMs: Number.isFinite(overrides.timeoutMs) ? overrides.timeoutMs : envConfig.timeoutMs,
    maxResponseBytes: Number.isFinite(overrides.maxResponseBytes)
      ? overrides.maxResponseBytes
      : envConfig.maxResponseBytes,
    maxResponseRamBytes: Number.isFinite(overrides.maxResponseRamBytes)
      ? overrides.maxResponseRamBytes
      : envConfig.maxResponseRamBytes
  };

  if (!resolved.workspace || !resolved.workflowId) {
    throw new Error('Missing Roboflow workspace/workflowId');
  }

  return resolved;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function buildImageId() {
  const timestamp = Date.now().toString(36);
  const randomToken = Math.random().toString(36).slice(2, 8);
  return `img_${timestamp}_${randomToken}`;
}

function buildJobId() {
  const timestamp = Date.now().toString(36);
  const randomToken = Math.random().toString(36).slice(2, 10);
  return `job_${timestamp}_${randomToken}`;
}

function nowMs() {
  return Date.now();
}

function ensureDeviceOnline() {
  if (!deviceOnline || !currentDeviceId) {
    throw new Error('DEVICE_OFFLINE');
  }
}

function ensureJobActive(jobId) {
  if (!jobId || jobId !== currentJobId) {
    const err = new Error('JOB_CANCELLED');
    err.code = 'JOB_CANCELLED';
    throw err;
  }
}

function normalizeMethod(methodRaw) {
  const s = typeof methodRaw === 'string' ? methodRaw.trim().toLowerCase() : '';
  if (!s) return '';
  // 常見同義詞
  const on = new Set(['on', 'open', 'turn on', 'turn_on', '開', '開燈', '打開', '啟動']);
  const off = new Set(['off', 'close', 'turn off', 'turn_off', '關', '關燈', '關閉', '熄燈', '關掉', '熄滅', '停止']);
  if (on.has(s)) return 'turn_on';
  if (off.has(s)) return 'turn_off';
  // 如果傳入已是 canonical
  if (s === 'turn_on' || s === 'turn_off') return s;
  return s.replace(/\s+/g, '_');
}

function normalizeDevice(deviceRaw) {
  const s = typeof deviceRaw === 'string' ? deviceRaw.trim().toLowerCase() : '';
  if (!s) return '';
  if (s === 'light' || s === 'lamp' || s === 'lights') return 'light';
  if (s === 'fan') return 'fan';
  return s;
}

function getIrCode(deviceRaw, methodRaw) {
  const device = normalizeDevice(deviceRaw);
  const method = normalizeMethod(methodRaw);
  if (!device || !IR_CODE_DICT[device]) {
    const err = new Error(`UNKNOWN_DEVICE: ${deviceRaw}`);
    err.code = 'UNKNOWN_DEVICE';
    throw err;
  }
  if (!method || !IR_CODE_DICT[device][method]) {
    const err = new Error(`UNKNOWN_METHOD: ${methodRaw}`);
    err.code = 'UNKNOWN_METHOD';
    throw err;
  }
  return { device, method, code: IR_CODE_DICT[device][method] };
}

function cleanupImageStore({ force = false } = {}) {
  const now = nowMs();

  // TTL eviction
  for (const [imageId, meta] of imageStore.entries()) {
    if (force || (meta?.createdAt && now - meta.createdAt > IMAGE_TTL_MS)) {
      try {
        if (meta?.filePath) fs.unlink(meta.filePath, () => undefined);
      } catch (_) {}
      imageStore.delete(imageId);
    }
  }

  // Size cap eviction (oldest first)
  if (imageStore.size > MAX_IMAGE_STORE_ENTRIES) {
    const entries = Array.from(imageStore.entries());
    entries.sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
    const overflow = imageStore.size - MAX_IMAGE_STORE_ENTRIES;
    for (let i = 0; i < overflow; i++) {
      const [imageId, meta] = entries[i];
      try {
        if (meta?.filePath) fs.unlink(meta.filePath, () => undefined);
      } catch (_) {}
      imageStore.delete(imageId);
    }
  }
}

function consumeImage(imageId) {
  const meta = imageStore.get(imageId);
  if (!meta) return;
  imageStore.delete(imageId);
  try {
    if (meta.filePath) fs.unlink(meta.filePath, () => undefined);
  } catch (_) {}
}

function sendError(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

function drainCommandsResponse(res) {
  // 單裝置/單 job MVP：直接吐出所有 pendingCommands
  const commands = pendingCommands.splice(0, pendingCommands.length);
  if (commands.length > 0) {
    logger.info(
      `[iotVisionTurret] dispatch ${commands.length} command(s) to device=${currentDeviceId || 'unknown'}`
    );
    for (const command of commands) {
      logger.info(`[iotVisionTurret] command detail: ${JSON.stringify(command)}`);
    }
  }
  return res.status(200).json({ ok: true, commands });
}

function enqueueCommand(command, { jobId } = {}) {
  if (jobId) ensureJobActive(jobId);
  ensureDeviceOnline();
  const enriched = { ...command, jobId: jobId || currentJobId || null, queuedAt: nowMs() };
  pendingCommands.push(enriched);
  
  //Server log
  logger.info(`[iotVisionTurret] enqueue command: ${JSON.stringify(enriched)}`);

  // 喚醒一個長輪詢
  const waiter = pendingPullWaiters.shift();
  if (waiter) {
    waiter.wake();
  }
}

function clearPendingCommandsForJob(jobId) {
  if (!jobId) {
    pendingCommands.length = 0;
    return;
  }
  for (let i = pendingCommands.length - 1; i >= 0; i--) {
    if (pendingCommands[i]?.jobId === jobId) {
      pendingCommands.splice(i, 1);
    }
  }
}

function terminateAllLongPolls(statusCode, message) {
  // 主動結束所有 in-flight /iot/pull
  while (pendingPullWaiters.length > 0) {
    const waiter = pendingPullWaiters.shift();
    try {
      if (waiter.timeoutId) clearTimeout(waiter.timeoutId);
      if (waiter.res && !waiter.res.headersSent) {
        if (statusCode === 204) {
          waiter.res.status(204).end();
        } else {
          waiter.res.status(statusCode).json({ ok: false, message });
        }
      } else if (waiter.res) {
        // headers 已送出就盡量結束
        waiter.res.end();
      }
    } catch (err) {
      logger.warn(`[iotVisionTurret] terminate long-poll failed: ${err.message}`);
    }
  }
}

function resetDeviceState(reason) {
  // 1) 清空指令（避免 reset 後舊指令被新裝置拉走）
  pendingCommands.length = 0;
  currentJobId = null;

  // 2) 結束所有長輪詢（避免連線 hang / leak）
  terminateAllLongPolls(409, `DEVICE_RESET: ${reason}`);

  // 3) 清理影像等待者（全部 reject，避免 job 永遠卡住）
  for (const [imageId, waiter] of imageWaiters.entries()) {
    try {
      if (waiter?.timer) clearTimeout(waiter.timer);
      if (waiter?.resolveTimer) clearTimeout(waiter.resolveTimer);
      waiter.reject(new Error(`IMAGE_WAIT_RESET: ${reason}`));
    } catch (_) {}
    imageWaiters.delete(imageId);
  }

  // 4) 清理 image store（含檔案）
  cleanupImageStore({ force: true });

  logger.info(`[iotVisionTurret] resetDeviceState: ${reason}`);
}

async function ensureUploadDir() {
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
}

function extractUploadBuffer(req) {
  const contentType = req.headers['content-type'] || '';
  const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  if (contentType.startsWith('application/octet-stream') || contentType.startsWith('image/')) {
    return bodyBuffer;
  }
  const err = new Error('UNSUPPORTED_CONTENT_TYPE');
  err.code = 'UNSUPPORTED_CONTENT_TYPE';
  throw err;
}

function waitForImage(imageId, timeoutMs) {
  return new Promise((resolve, reject) => {
    // 先吃 store（允許 out-of-order upload）
    if (imageStore.has(imageId)) {
      return resolve(imageStore.get(imageId).filePath);
    }
    if (imageWaiters.has(imageId)) {
      const err = new Error(`DUPLICATE_WAITER: ${imageId}`);
      err.code = 'DUPLICATE_WAITER';
      return reject(err);
    }
    const timer = setTimeout(() => {
      const waiter = imageWaiters.get(imageId);
      if (waiter?.resolveTimer) clearTimeout(waiter.resolveTimer);
      imageWaiters.delete(imageId);
      const err = new Error(`UPLOAD_TIMEOUT: ${imageId}`);
      err.code = 'UPLOAD_TIMEOUT';
      reject(err);
    }, timeoutMs);

    imageWaiters.set(imageId, { resolve, reject, timer, resolveTimer: null });
  });
}

async function readJsonWithLimit(resp, maxBytes, maxRamBytes, controller) {
  const limit = Number.isFinite(maxBytes) ? maxBytes : DEFAULT_ROBOFLOW_MAX_RESPONSE_BYTES;
  const ramLimit = Number.isFinite(maxRamBytes) ? maxRamBytes : DEFAULT_ROBOFLOW_MAX_RESPONSE_RAM_BYTES;
  if (!resp.body || typeof resp.body.on !== 'function') {
    const text = await resp.text();
    if (Buffer.byteLength(text) > ramLimit) {
      const err = new Error('ROBOFLOW_RESPONSE_TOO_LARGE');
      err.code = 'ROBOFLOW_RESPONSE_TOO_LARGE';
      throw err;
    }
    return JSON.parse(text);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onData = (chunk) => {
      total += chunk.length;
      if (total > limit) {
        const err = new Error('ROBOFLOW_RESPONSE_TOO_LARGE');
        err.code = 'ROBOFLOW_RESPONSE_TOO_LARGE';
        cleanup();
        try {
          if (controller) controller.abort();
        } catch (_) {}
        if (resp.body && typeof resp.body.destroy === 'function') {
          resp.body.destroy(err);
        }
        reject(err);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    };
    const cleanup = () => {
      resp.body.off('data', onData);
      resp.body.off('end', onEnd);
      resp.body.off('error', onError);
    };

    resp.body.on('data', onData);
    resp.body.on('end', onEnd);
    resp.body.on('error', onError);
  });
}

async function callRoboflowWorkflowBase64(imageBase64, roboflowConfig) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(roboflowConfig?.timeoutMs) ? roboflowConfig.timeoutMs : DEFAULT_ROBOFLOW_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseUrl = String(roboflowConfig?.baseUrl || DEFAULT_ROBOFLOW_BASE_URL).replace(/\/$/, '');
    const url = `${baseUrl}/infer/workflows/${roboflowConfig.workspace}/${roboflowConfig.workflowId}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // node-fetch v2: size option limits response body in bytes
      // size: Number.isFinite(roboflowConfig?.maxResponseBytes)
      //   ? roboflowConfig.maxResponseBytes
      //   : DEFAULT_ROBOFLOW_MAX_RESPONSE_BYTES,
      signal: controller.signal,
      body: JSON.stringify({
        api_key: roboflowConfig?.apiKey || '',
        inputs: {
          image: { type: 'base64', value: imageBase64 }
        }
      })
    });

    if (!resp.ok) {
      const err = new Error(`ROBOFLOW_HTTP_${resp.status}`);
      err.code = 'ROBOFLOW_HTTP_ERROR';
      logger.error(`[iotVisionTurret] Roboflow workflow call failed: ${resp.status} ${resp.statusText}`);
      throw err;
    }else{
      logger.info(`[iotVisionTurret] Roboflow workflow call succeeded: ${resp.status} ${resp.statusText}`);
    }

    const maxBytes = Number.isFinite(roboflowConfig?.maxResponseBytes)
      ? roboflowConfig.maxResponseBytes
      : DEFAULT_ROBOFLOW_MAX_RESPONSE_BYTES;
    // const json = await readJsonWithLimit(
    //   resp,
    //   maxBytes,
    //   roboflowConfig?.maxResponseRamBytes,
    //   controller
    // );
    const json = await resp.json();
    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeRoboflowResult(json, targetClass) {
  // 兼容 index-json.js 的 outputs[0].predictions.predictions
  const outputs = json?.outputs;
  const predictions = outputs?.[0]?.predictions?.predictions;
  const list = Array.isArray(predictions) ? predictions : [];
  const wanted = typeof targetClass === 'string' ? targetClass.trim() : '';
  const candidates = wanted
    ? list.filter((p) => String(p?.class || '').trim() === wanted)
    : list;
  // 取最高 confidence
  let best = null;
  for (const p of candidates) {
    if (!p) continue;
    if (!best || (Number(p.confidence) || 0) > (Number(best.confidence) || 0)) best = p;
  }

  // 嘗試取 bbox center
  if (!best) return { found: false, center: null, imageSize: null, raw: json };
  const x = Number(best.x);
  const y = Number(best.y);
  const width = Number(json?.outputs?.[0]?.predictions?.image?.width || json?.image?.width || 0);
  const height = Number(json?.outputs?.[0]?.predictions?.image?.height || json?.image?.height || 0);

  // Server Log
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    logger.info('[iotVisionTurret] Roboflow result: target not found in image');
    return { found: false, center: null, imageSize: null, raw: json };
  }else{
    logger.info(`[iotVisionTurret] Roboflow result: target found at (x=${x}, y=${y}) in image size (w=${width}, h=${height})`);
  }

  return {
    found: true,
    center: { x, y },
    imageSize: width && height ? { width, height } : null,
    raw: json
  };
}

function computeStepDegrees(dxPx, dyPx, w, h) {
  // 粗估：像素偏移占比 -> 視角偏移 -> gain
  const yawErrDeg = (dxPx / w) * CAMERA_H_FOV_DEG;
  const pitchErrDeg = (dyPx / h) * CAMERA_V_FOV_DEG;
  const yawStep = clamp(yawErrDeg * TRACK_MOVE_GAIN, -MAX_STEP_DEG, MAX_STEP_DEG);
  const pitchStep = clamp(pitchErrDeg * TRACK_MOVE_GAIN, -MAX_STEP_DEG, MAX_STEP_DEG);
  return { yawStep, pitchStep };
}

async function inferFromImagePath(imagePath) {
  const stat = await fs.promises.stat(imagePath);
  if (!stat.isFile()) throw new Error('IMAGE_NOT_FILE');
  if (stat.size > MAX_IMAGE_BYTES) {
    const err = new Error(`IMAGE_TOO_LARGE: ${stat.size}`);
    err.code = 'IMAGE_TOO_LARGE';
    throw err;
  }
  const imageBase64 = await fs.promises.readFile(imagePath, { encoding: 'base64' });
  if (!state.roboflow) {
    throw new Error('ROBOFLOW_CONFIG_MISSING');
  }
  const json = await callRoboflowWorkflowBase64(imageBase64, state.roboflow);
  logger.info(`[iotVisionTurret] Roboflow workflow inference completed , ${json}`);
  return normalizeRoboflowResult(json, state.roboflow.targetClass);
}

// ───────────────────────────────────────────────
// scan -> track -> fire
// ───────────────────────────────────────────────

async function captureAndInfer(deadlineMs, jobId) {
  const imageId = buildImageId();
  ensureJobActive(jobId);
  enqueueCommand({ type: 'capture', image_id: imageId }, { jobId });
  // 讓 event loop 有機會先處理 upload（可覆蓋 out-of-order 情境）
  await new Promise((resolve) => setImmediate(resolve));
  const remaining = deadlineMs - nowMs();
  if (remaining <= 0) throw new Error('TASK_TIMEOUT');
  ensureJobActive(jobId);
  const imagePath = await waitForImage(imageId, Math.min(UPLOAD_TIMEOUT_MS, remaining));
  ensureJobActive(jobId);
  const result = await inferFromImagePath(imagePath);
  // 用完就回收檔案與 store（避免 disk/mem 無限增長）
  if (deleteImage) consumeImage(imageId);
  cleanupImageStore();
  return result;
}

async function aimAndFire({ device, method, code }, deadlineMs, jobId) {
  let yaw = 0;
  let pitch = 0;

  // 1) scan
  let last = null;
  for (const p of SCAN_PITCH_LIST) {
    for (const y of SCAN_YAW_LIST) {
      ensureJobActive(jobId);
      if (nowMs() >= deadlineMs) throw new Error('TASK_TIMEOUT');
      yaw = clamp(y, YAW_MIN, YAW_MAX);
      pitch = clamp(p, PITCH_MIN, PITCH_MAX);
      enqueueCommand({ type: 'move', yaw, pitch }, { jobId });
      last = await captureAndInfer(deadlineMs, jobId);
      if (last?.found) break;
    }
    if (last?.found) break;
  }
  if (!last?.found) return { ok: false };

  // 2) track
  for (let step = 0; step < TRACK_MAX_STEPS; step++) {
    ensureJobActive(jobId);
    if (nowMs() >= deadlineMs) throw new Error('TASK_TIMEOUT');
    if (!last?.found || !last?.center || !last?.imageSize) break;

    const { width, height } = last.imageSize;
    const dx = last.center.x - width / 2;
    const dy = last.center.y - height / 2;

    // 機構限制：pitch 已到底(0)且目標仍在畫面下方時，dy 永遠不可能收斂到 tolerance。
    // 這種情況下，只要水平(dx)已對準，就直接發 IR，避免「看起來鎖定但永遠不發射」。
    // 你提出的策略：若垂直軸已到下限（無法再往下），就只保證 X 對齊即可發射 IR。
    // 這能避免「目標在下方、dy 永遠無法收斂」導致永遠不發射。
    if (pitch === PITCH_MIN && Math.abs(dx) <= TRACK_PIXEL_TOLERANCE) {
      logger.info(`[iotVisionTurret] pitch-bottom lock: fire (step=${step}, dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)}, yaw=${yaw.toFixed(1)}, pitch=${pitch.toFixed(1)})`);
      enqueueCommand({ type: 'ir_send', device, code }, { jobId });
      return { ok: true };
    }

    if (Math.abs(dx) <= TRACK_PIXEL_TOLERANCE && Math.abs(dy) <= TRACK_PIXEL_TOLERANCE) {
      // locked
      logger.info(`[iotVisionTurret] locked: fire (step=${step}, dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)}, yaw=${yaw.toFixed(1)}, pitch=${pitch.toFixed(1)})`);
      enqueueCommand({ type: 'ir_send', device, code }, { jobId });
      return { ok: true };
    }

    const { yawStep, pitchStep } = computeStepDegrees(dx, dy, width, height);

    // yaw: dx>0 -> target to right -> yaw increase
    yaw = clamp(yaw + yawStep * YAW_DIR, YAW_MIN, YAW_MAX);

    // pitch: dy>0 -> target below center -> 理論需要往下（pitch -）
    // 但垂直軸下限為 0，不能往下；所以使用 clamp 後會卡在 0。
    // 這裡採用「pitch - step」是因為 pitch 增加代表鏡頭往上（依你先前規則），
    // 若你機構相反，只要把符號翻轉即可。
    pitch = clamp(pitch - pitchStep * PITCH_DIR, PITCH_MIN, PITCH_MAX);

    enqueueCommand({ type: 'move', yaw, pitch }, { jobId });
    last = await captureAndInfer(deadlineMs, jobId);

    // 若目標在下方但 pitch 已到 0：不再嘗試負角（機構限制），仍允許繼續 yaw 修正。
    // 注意：這裡必須用「最新一張」的 dy 判斷，避免用上一張的 dy 造成誤判。
    const lastDy = (last?.center && last?.imageSize)
      ? (last.center.y - (last.imageSize.height / 2))
      : null;
    if (pitch === PITCH_MIN && Number.isFinite(lastDy) && lastDy > 0) {
      // 只要仍能找到目標，就給一次 IR（避免永遠追不到）
      if (last?.found) {
        const lastDx = (last?.center && last?.imageSize)
          ? (last.center.x - (last.imageSize.width / 2))
          : NaN;
        logger.info(`[iotVisionTurret] pitch-bottom fallback: fire (step=${step}, dx=${Number.isFinite(lastDx) ? lastDx.toFixed(1) : 'n/a'}, dy=${Number.isFinite(lastDy) ? lastDy.toFixed(1) : 'n/a'}, yaw=${yaw.toFixed(1)}, pitch=${pitch.toFixed(1)})`);
        enqueueCommand({ type: 'ir_send', device, code }, { jobId });
        return { ok: true };
      }
    }
  }

  // 3) give up
  return { ok: false };
}

// ───────────────────────────────────────────────
// 路由
// ───────────────────────────────────────────────

function registerRoutes(app) {
  if (app?.locals && app.locals[ROUTES_INSTALLED_FLAG]) {
    logger.warn('[iotVisionTurret] routes already installed on this app; skip');
    routesRegistered = true;
    registeredAppRef = app;
    return;
  }
  // 允許更換 expressApp 時重新註冊（注意：無法自動卸載舊 app 的 router）
  if (routesRegistered && registeredAppRef === app) {
    logger.warn('[iotVisionTurret] routes already registered on this app; skip');
    return;
  }

  const router = express.Router();
  router.use(express.json({ limit: '512kb' }));

  router.post('/iot/register', async (req, res) => {
    if (!req.is('application/json')) return sendError(res, 415, 'must be application/json');
    const deviceId = typeof req.body?.device_id === 'string' ? req.body.device_id.trim() : '';
    if (!deviceId) return sendError(res, 400, 'device_id required');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(deviceId)) return sendError(res, 400, 'invalid device_id');

    if (jobLock) {
      logger.warn('[iotVisionTurret] re-register while job running; cancel current job');
    }

    resetDeviceState('device re-register');
    currentDeviceId = deviceId;
    deviceOnline = true;

    return res.status(200).json({
      ok: true,
      device_id: deviceId,
      pull_url: '/iot/pull',
      upload_url: '/iot/upload'
    });
  });

  router.get('/iot/pull', async (req, res) => {
    if (!deviceOnline || !currentDeviceId) return sendError(res, 409, 'device not registered');

    if (pendingCommands.length > 0) return drainCommandsResponse(res);

    let finished = false;
    const waiter = {
      res,
      timeoutId: null,
      wake: () => {
        if (finished) return;
        finished = true;
        if (waiter.timeoutId) clearTimeout(waiter.timeoutId);
        drainCommandsResponse(res);
      }
    };

    waiter.timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      const idx = pendingPullWaiters.indexOf(waiter);
      if (idx >= 0) pendingPullWaiters.splice(idx, 1);
      res.status(204).end();
    }, LONG_POLL_TIMEOUT_MS);

    req.on('close', () => {
      if (finished) return;
      finished = true;
      if (waiter.timeoutId) clearTimeout(waiter.timeoutId);
      const idx = pendingPullWaiters.indexOf(waiter);
      if (idx >= 0) pendingPullWaiters.splice(idx, 1);
    });

    pendingPullWaiters.push(waiter);

    // 二次檢查避免 missed wakeup
    if (pendingCommands.length > 0 && !finished) {
      finished = true;
      if (waiter.timeoutId) clearTimeout(waiter.timeoutId);
      const idx = pendingPullWaiters.indexOf(waiter);
      if (idx >= 0) pendingPullWaiters.splice(idx, 1);
      drainCommandsResponse(res);
    }
  });

  router.post(
    '/iot/upload',
    express.raw({ type: ['application/octet-stream', 'image/*'], limit: '20mb' }),
    async (req, res) => {
      if (!deviceOnline || !currentDeviceId) return sendError(res, 409, 'device not registered');

      const imageId = typeof req.query?.image_id === 'string' ? req.query.image_id.trim() : '';
      if (!imageId) return sendError(res, 400, 'image_id required');
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(imageId)) return sendError(res, 400, 'invalid image_id');

      try {
        const buf = extractUploadBuffer(req);
        if (!buf || buf.length === 0) return sendError(res, 400, 'empty body');
        if (buf.length > MAX_IMAGE_BYTES) return sendError(res, 413, 'image too large');

        await ensureUploadDir();
        const filePath = path.join(UPLOAD_DIR, `${imageId}.jpg`);

        // 覆寫寫入（允許 device retry / out-of-order）
        await fs.promises.writeFile(filePath, buf);

        // 先更新 store
        imageStore.set(imageId, { filePath, createdAt: nowMs() });

        // 若 waiter 存在：resolve（重複上傳也要 resolve 最新檔案，不要 reject）
        const waiter = imageWaiters.get(imageId);
        if (waiter) {
          if (waiter.resolveTimer) clearTimeout(waiter.resolveTimer);
          if (waiter.timer) {
            clearTimeout(waiter.timer);
            waiter.timer = null;
          }
          waiter.resolveTimer = setTimeout(() => {
            const latest = imageStore.get(imageId);
            imageWaiters.delete(imageId);
            try {
              if (latest?.filePath) {
                waiter.resolve(latest.filePath);
              } else {
                waiter.reject(new Error(`UPLOAD_MISSING: ${imageId}`));
              }
            } catch (_) {}
          }, UPLOAD_RESOLVE_DEBOUNCE_MS);
        }

        cleanupImageStore();
        return res.status(200).json({ ok: true });
      } catch (err) {
        if (err?.code === 'UNSUPPORTED_CONTENT_TYPE') return sendError(res, 415, 'unsupported content-type');
        logger.error(`[iotVisionTurret] upload failed: ${err.message}`);
        return sendError(res, 500, 'upload failed');
      }
    }
  );

  app.use(router);
  if (app.locals) {
    app.locals[ROUTES_INSTALLED_FLAG] = true;
  }
  routesRegistered = true;
  registeredAppRef = app;
  logger.info('[iotVisionTurret] routes registered');
}

// ───────────────────────────────────────────────
// Plugin interface
// ───────────────────────────────────────────────

const state = {
  online: false,
  roboflow: null
};

module.exports = {
  priority,

  async online(options = {}) {
    if (!options.expressApp) {
      throw new Error('Missing expressApp');
    }
    state.roboflow = resolveRoboflowConfig(options);
    registerRoutes(options.expressApp);
    await ensureUploadDir();
    state.online = true;
    logger.info('[iotVisionTurret] online');
  },

  async offline() {
    state.online = false;
    state.roboflow = null;
    deviceOnline = false;
    currentDeviceId = null;
    jobLock = false;
    currentJobId = null;
    resetDeviceState('plugin offline');

    // 若使用同一個 app，多次 online() 會因 app.locals flag 而跳過重複註冊。
    // 若傳入新 app，仍允許重新註冊。
    routesRegistered = false;
    registeredAppRef = null;

    logger.info('[iotVisionTurret] offline');
  },

  async restart(options = {}) {
    await this.offline();
    await this.online(options);
  },

  async state() {
    return state.online ? 1 : 0;
  },

  /**
   * 工具呼叫入口：只回傳 { ok:true } / { ok:false }
   * input schema（新版）：{ device, method }
   */
  async send(data = {}) {
    let jobId = null;
    try {
      if (!state.online) return { ok: false };
      if (jobLock) return { ok: false };
      if (!deviceOnline || !currentDeviceId) return { ok: false };

      const deviceRaw = data.device || 'light';
      const methodRaw = data.method || data.input || 'turn_on';
      const { device, method, code } = getIrCode(deviceRaw, methodRaw);

      jobLock = true;
      jobId = buildJobId();
      currentJobId = jobId;
      const deadlineMs = nowMs() + TASK_TIMEOUT_MS;

      // 清掉任何前次殘留（保守策略）
      pendingCommands.length = 0;

      const result = await aimAndFire({ device, method, code }, deadlineMs, jobId);
      return { ok: Boolean(result?.ok) };
    } catch (err) {
      logger.error(`[iotVisionTurret] send failed: ${err.message}`);
      return { ok: false };
    } finally {
      // 將本 job 的殘留指令清掉，避免 fail 後在下一次 /iot/pull 被執行
      clearPendingCommandsForJob(jobId);
      currentJobId = null;
      jobLock = false;
      cleanupImageStore();
    }
  },

  async waitImage(imageId, timeoutMs = 30000) {
    return waitForImage(imageId, timeoutMs);
  }
};
