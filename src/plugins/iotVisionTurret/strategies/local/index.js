const path = require('path');
const fs = require('fs');
const express = require('express');
const { spawn } = require('child_process');
const Logger = require('../../../../utils/logger');

// 檔案用途：提供 iotVisionTurret 本地策略，負責呼叫 Python runner 與管理狀態

// 建立記錄器（對外顯示名稱統一為 iotVisionTurret）
const logger = new Logger('iotVisionTurret');

// 狀態資料結構區塊：保存服務狀態、設定與最近執行結果
const state = {
  online: false,
  lastError: null,
  lastResult: null,
  config: {
    pythonPath: 'python3',
    runnerPath: path.join(__dirname, 'index.py'),
    timeoutMs: 15000
  },
  metrics: {
    lastRunAt: null,
    totalRuns: 0
  }
};

// 併發控制：保存正在執行的 Promise 與佇列
let activeRequest = null;

// ───────────────────────────────────────────────
// IoT 裝置通訊狀態（模組層級，禁止放在 request scope）
// ───────────────────────────────────────────────
// 待送出的指令佇列：儲存等待裝置拉取的命令
const pendingCommands = [];
// 影像等待者：用 image_id 對應 resolve/reject 與 timeout 設定
const imageWaiters = new Map();
// 影像儲存索引：用 image_id 對應實際檔案路徑
const imageStore = new Map();
// 目前在線裝置 ID：裝置註冊後會更新
let currentDeviceId = null;
// 裝置在線狀態：register 成功後設為 true
let deviceOnline = false;
// 作業鎖：避免多個長流程同時寫入造成衝突
let jobLock = false;

// 長輪詢等待隊列：用於在沒有指令時等待裝置連線
const pendingPullWaiters = [];

// 長輪詢逾時設定（ms）
const LONG_POLL_TIMEOUT_MS = 25000;
// 上傳檔案儲存目錄
const UPLOAD_DIR = path.resolve(process.cwd(), 'artifacts', 'iotVisionTurret');

// 路由註冊狀態：避免重複註冊 Express 路由
let routesRegistered = false;

// 預設啟動優先度
const priority = 50;

// ───────────────────────────────────────────────
// iotVisionTurret 掃描/追蹤/IR 流程參數（可依需求調整）
// ───────────────────────────────────────────────
// 全域任務逾時（ms）
const TASK_TIMEOUT_MS = 45000;
// 單張影像上傳等待逾時（ms）
const UPLOAD_TIMEOUT_MS = 5000;
// 掃描 pitch 序列（外圈）
// 注意：pitch 在本裝置上僅安全支援到約 120 度，因機械結構限制
// 若未來機構/伺服馬達可支援完整 0–180 度，請一併調整此列表與相關參數
const SCAN_PITCH_LIST = [0, 30, 60, 90, 120];
// 掃描 yaw 序列（內圈，允許完整 0–180 度掃描）
const SCAN_YAW_LIST = [0, 45, 90, 135, 180];
// 追蹤最大迭代次數
const TRACK_MAX_ITERATIONS = 12;
// LOCKED 連續達標次數
const LOCK_STREAK = 2;
// 追蹤增益與最大步進（角度）
const YAW_GAIN_DEG = 60;
const PITCH_GAIN_DEG = 60;
const YAW_MAX_STEP = 25;
const PITCH_MAX_STEP = 25;
// LOCKED 收斂判定閾值（像素）
const LOCKED_CONVERGENCE_THRESHOLD = 20;

// ───────────────────────────────────────────────
// iotVisionTurret 掃描/追蹤共用工具函式
// ───────────────────────────────────────────────

/**
 * 限制數值在指定範圍內
 * @param {number} value - 原始數值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 限制後的數值
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 產生唯一影像 ID（符合英數字/底線/連字號規範）
 * @returns {string} 影像 ID
 */
function buildImageId() {
  const timestamp = Date.now().toString(36);
  const randomToken = Math.random().toString(36).slice(2, 8);
  return `img_${timestamp}_${randomToken}`;
}

/**
 * 根據 deadline 計算剩餘時間（ms）
 * @param {number} deadline - 絕對時間戳記
 * @returns {number} 剩餘時間
 */
function getRemainingMs(deadline) {
  return deadline - Date.now();
}

/**
 * 正規化 YOLO 推論結果，抽取必要欄位
 * @param {Object} result - 原始推論結果
 * @returns {Object} 正規化結果
 */
function normalizeYoloResult(result) {
  const payload = result?.payload ?? result ?? {};
  const found = Boolean(payload?.found);
  const center = payload?.center ?? payload?.target?.center ?? null;
  const imageSize = payload?.image_size ?? payload?.imageSize ?? payload?.image?.size ?? null;
  return { found, center, imageSize, raw: payload };
}

/**
 * 處理佇列中的請求，確保一次只有一個請求執行
 * @param {Object} data - 請求資料
 * @returns {Promise<boolean>}
 */
async function executeRequest(data) {
  // 等待前一個請求完成
  while (activeRequest) {
    try {
      await activeRequest;
    } catch (e) {
      // 忽略前一個請求的錯誤
      logger.warn('前一個請求失敗: ' + e.message);
    }
  }
  
  // 建立當前請求的 Promise
  const requestPromise = (async () => {
    try {
      const response = await runPython({ action: 'infer', payload: data }, state.config);
      state.lastResult = response;
      state.lastError = null;
      state.metrics.lastRunAt = new Date().toISOString();
      state.metrics.totalRuns += 1;
      return true;
    } finally {
      // 完成後清空 active request（僅當前請求）
      if (activeRequest === requestPromise) {
        activeRequest = null;
      }
    }
  })();
  
  // 立即設定為活動請求
  activeRequest = requestPromise;
  return await requestPromise;
}

/**
 * 合併與驗證設定
 * @param {Object} options - 來源設定
 * @returns {Object} 合併後設定
 */
function buildConfig(options = {}) {
  return {
    pythonPath: options.pythonPath || state.config.pythonPath,
    runnerPath: options.runnerPath || state.config.runnerPath,
    timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : state.config.timeoutMs
  };
}

// ───────────────────────────────────────────────
// IoT 裝置狀態與路由共用工具函式
// ───────────────────────────────────────────────

/**
 * 統一清空裝置狀態與等待者
 * @param {string} reason - 清空原因
 */
function resetDeviceState(reason) {
  // 清空待送指令
  pendingCommands.length = 0;

  // 清空長輪詢等待者
  for (const waiter of pendingPullWaiters) {
    if (waiter.timeoutId) {
      clearTimeout(waiter.timeoutId);
    }
  }
  pendingPullWaiters.length = 0;

  // 清除所有影像等待者並回報錯誤
  for (const [imageId, waiter] of imageWaiters.entries()) {
    clearTimeout(waiter.timer);
    try {
      waiter.reject(new Error(`影像等待被重置：${reason}`));
    } catch (err) {
      logger.warn(`[iotVisionTurret] 清理影像等待者失敗：${imageId} (${err.message})`);
    }
    imageWaiters.delete(imageId);
  }

  // 清空影像快取
  imageStore.clear();

  logger.info(`[iotVisionTurret] 已重置裝置狀態：${reason}`);
}

/**
 * 回傳錯誤訊息給裝置或呼叫端
 * @param {Object} res - Express response
 * @param {number} status - HTTP 狀態碼
 * @param {string} message - 錯誤訊息
 */
function sendError(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

/**
 * 將待送指令回傳並清空佇列
 * @param {Object} res - Express response
 */
function drainCommandsResponse(res) {
  // 一次取完所有指令，回傳後清空佇列
  const commands = pendingCommands.splice(0, pendingCommands.length);
  logger.info(`[iotVisionTurret] 已回傳 ${commands.length} 筆指令並清空佇列`);
  return res.status(200).json({ ok: true, commands });
}

/**
 * 新增待送指令並嘗試喚醒長輪詢
 * @param {Object} command - 指令內容
 */
function enqueueCommand(command) {
  // 若裝置尚未註冊則拒絕加入
  if (!deviceOnline) {
    throw new Error('裝置尚未註冊，無法加入指令');
  }
  pendingCommands.push(command);
  logger.info('[iotVisionTurret] 已加入一筆待送指令');

  // 喚醒等待中的長輪詢（若有）
  const waiter = pendingPullWaiters.shift();
  if (waiter) {
    try {
      waiter.resolve();
    } catch (err) {
      logger.warn(`[iotVisionTurret] 喚醒長輪詢失敗：${err.message}`);
    }
  }
}

/**
 * 建立影像等待者，用於等待指定 image_id 上傳
 * @param {string} imageId - 影像 ID
 * @param {number} timeoutMs - 逾時時間
 * @returns {Promise<string>} 影像檔案路徑
 */
function waitForImage(imageId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    // 若影像已存在則直接回傳
    if (imageStore.has(imageId)) {
      logger.info(`[iotVisionTurret] 影像已存在，立即回傳：${imageId}`);
      return resolve(imageStore.get(imageId));
    }

    // 若已有等待者則拒絕重複等待
    if (imageWaiters.has(imageId)) {
      return reject(new Error(`影像 ${imageId} 已有等待者，拒絕重複等待`));
    }

    // 建立逾時計時器，避免長時間等待
    const timer = setTimeout(() => {
      imageWaiters.delete(imageId);
      logger.warn(`[iotVisionTurret] 影像等待逾時：${imageId}`);
      reject(new Error(`影像等待逾時：${imageId}`));
    }, timeoutMs);

    imageWaiters.set(imageId, { resolve, reject, timer });
  });
}



/**
 * 解析上傳內容，僅支援 binary body (application/octet-stream 或 image/*)
 * @param {Object} req - Express request
 * @returns {Buffer} 影像內容
 */
function extractUploadBuffer(req) {
  const contentType = req.headers['content-type'] || '';
  const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

  // 僅支援 binary body（application/octet-stream 或 image/*）
  if (contentType.startsWith('application/octet-stream') || contentType.startsWith('image/')) {
    return bodyBuffer;
  }

  throw new Error('不支援的 Content-Type，僅支援 application/octet-stream 或 image/*');
}

/**
 * 確保上傳資料夾存在
 */
async function ensureUploadDir() {
  // 建立上傳目錄，避免寫入時出錯
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
}

/**
 * 註冊 IoT 裝置通訊路由
 * @param {Object} app - Express app
 */
function registerRoutes(app) {
  // 避免重複註冊路由
  if (routesRegistered) {
    logger.warn('[iotVisionTurret] 路由已註冊，跳過重複註冊');
    return;
  }

  const router = express.Router();

  // 解析 JSON body（僅針對 application/json）
  router.use(express.json({ limit: '256kb' }));

  // 裝置註冊：POST /iot/register
  router.post('/iot/register', async (req, res) => {
    // 解析 JSON body，避免未解析導致空值
    if (!req.is('application/json')) {
      logger.warn('[iotVisionTurret] 註冊請求 Content-Type 非 JSON');
      return sendError(res, 415, '必須使用 application/json');
    }

    const deviceId = typeof req.body?.device_id === 'string' ? req.body.device_id.trim() : '';
    if (!deviceId) {
      logger.warn('[iotVisionTurret] 註冊失敗：device_id 缺失');
      return sendError(res, 400, 'device_id 為必填欄位');
    }

    // 驗證 device_id 格式：僅允許英數字、底線、連字號，長度 1-64
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(deviceId)) {
      logger.warn(`[iotVisionTurret] 註冊失敗：device_id 格式不符：${deviceId}`);
      return sendError(res, 400, 'device_id 僅允許英數字、底線、連字號，長度 1-64 字元');
    }

    // 檢查是否有上傳作業進行中，避免在上傳時重置狀態造成衝突
    if (jobLock) {
      logger.warn(`[iotVisionTurret] 註冊被拒絕：目前有上傳作業進行中`);
      return sendError(res, 409, '目前有上傳作業進行中，請稍後再試');
    }

    // 先重置舊狀態，再標記裝置上線
    resetDeviceState('裝置重新註冊');
    currentDeviceId = deviceId;
    deviceOnline = true;

    logger.info(`[iotVisionTurret] 裝置已上線：${deviceId}，狀態已重置`);
    return res.status(200).json({
      ok: true,
      device_id: deviceId,
      pull_url: '/iot/pull',
      upload_url: '/iot/upload'
    });
  });

  // 裝置長輪詢：GET /iot/pull
  router.get('/iot/pull', async (req, res) => {
    // 裝置未註冊時拒絕
    if (!deviceOnline || !currentDeviceId) {
      logger.warn('[iotVisionTurret] 裝置未註冊卻嘗試拉取指令');
      return sendError(res, 409, '裝置尚未註冊');
    }

    // 若有待送指令，立即回傳
    if (pendingCommands.length > 0) {
      return drainCommandsResponse(res);
    }

    // 無指令時進入長輪詢等待
    logger.info('[iotVisionTurret] 無待送指令，進入長輪詢等待');
    let finished = false;
    const waiter = {
      resolve: () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        drainCommandsResponse(res);
      }
    };

    const timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      const index = pendingPullWaiters.indexOf(waiter);
      if (index >= 0) {
        pendingPullWaiters.splice(index, 1);
      }
      logger.info('[iotVisionTurret] 長輪詢逾時，回傳 204');
      res.status(204).end();
    }, LONG_POLL_TIMEOUT_MS);

    // 當 client 中斷連線時清理等待者
    req.on('close', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      const index = pendingPullWaiters.indexOf(waiter);
      if (index >= 0) {
        pendingPullWaiters.splice(index, 1);
      }
      logger.warn('[iotVisionTurret] 長輪詢連線中斷，已清理等待者');
    });

    // 先加入等待者
    pendingPullWaiters.push(waiter);
    
    // 再次檢查是否有新指令加入，避免以下競態條件：
    // 1. 第一次檢查時 pendingCommands 為空
    // 2. enqueueCommand 在另一個非同步操作中被呼叫，但此時 waiter 尚未加入 pendingPullWaiters
    // 3. enqueueCommand 無法喚醒 waiter（因為還沒加入）
    // 4. waiter 加入後會一直等待直到逾時
    // 透過二次檢查，確保不會錯過在加入 waiter 前後到達的指令
    if (pendingCommands.length > 0 && !finished) {
      finished = true;
      clearTimeout(timeoutId);
      const index = pendingPullWaiters.indexOf(waiter);
      if (index >= 0) {
        pendingPullWaiters.splice(index, 1);
      }
      drainCommandsResponse(res);
    }
  });

  // 影像上傳：POST /iot/upload?image_id=...
  router.post('/iot/upload', express.raw({ type: ['application/octet-stream', 'image/*'], limit: '20mb' }), async (req, res) => {
    // 裝置未註冊時拒絕
    if (!deviceOnline || !currentDeviceId) {
      logger.warn('[iotVisionTurret] 裝置未註冊卻嘗試上傳影像');
      return sendError(res, 409, '裝置尚未註冊');
    }

    const imageId = typeof req.query?.image_id === 'string' ? req.query.image_id.trim() : '';
    if (!imageId) {
      logger.warn('[iotVisionTurret] 上傳失敗：缺少 image_id');
      return sendError(res, 400, 'image_id 為必填 query 參數');
    }

    // 驗證 imageId 格式：僅允許英數字、底線、連字號，防止路徑穿越攻擊
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(imageId)) {
      logger.warn(`[iotVisionTurret] 上傳失敗：image_id 格式不符：${imageId}`);
      return sendError(res, 400, 'image_id 僅允許英數字、底線、連字號，長度 1-64 字元');
    }

    logger.info(`[iotVisionTurret] 收到影像上傳，Content-Type=${req.headers['content-type'] || 'unknown'}`);

    // 避免同時處理多筆上傳，確保寫入一致
    if (jobLock) {
      logger.warn(`[iotVisionTurret] 上傳被鎖定，拒絕影像 ${imageId}`);
      return sendError(res, 409, '目前有其他上傳作業進行中');
    }

    if (imageStore.has(imageId)) {
      logger.warn(`[iotVisionTurret] 重複 image_id：${imageId}`);
      return sendError(res, 409, 'image_id 已存在，請使用新的 ID');
    }

    jobLock = true;
    try {
      const imageBuffer = extractUploadBuffer(req);
      if (!imageBuffer || imageBuffer.length === 0) {
        logger.warn('[iotVisionTurret] 上傳內容為空');
        return sendError(res, 400, '上傳內容不可為空');
      }

      await ensureUploadDir();
      const filePath = path.join(UPLOAD_DIR, `${imageId}.jpg`);
      await fs.promises.writeFile(filePath, imageBuffer);

      imageStore.set(imageId, filePath);
      logger.info(`[iotVisionTurret] 影像已儲存：${filePath}`);

      // 若有等待者則立即回傳
      const waiter = imageWaiters.get(imageId);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(filePath);
        imageWaiters.delete(imageId);
        logger.info(`[iotVisionTurret] 影像等待者已解除：${imageId}`);
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      logger.error(`[iotVisionTurret] 影像上傳失敗：${err.message}`);
      return sendError(res, 500, err.message);
    } finally {
      jobLock = false;
    }
  });

  routesRegistered = true;
  logger.info('[iotVisionTurret] IoT 裝置路由已註冊');
  app.use(router);
}

/**
 * 呼叫本地 Python runner 並取得回應
 * @param {Object} payload - 傳遞給 Python 的 JSON 內容
 * @param {Object} config - 執行設定
 * @returns {Promise<Object>} Python 回傳結果
 */
function runPython(payload, config) {
  return new Promise((resolve, reject) => {
    const processArgs = [config.runnerPath];
    const child = spawn(config.pythonPath, processArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error('Python runner 執行逾時'));
      }
    }, config.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(`Python runner 非正常結束 (code=${code}): ${stderr}`));
        return;
      }
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : {};
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Python runner 回傳 JSON 解析失敗: ${err.message}`));
      }
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(err);
    }
  });
}

module.exports = {
  priority,
  /**
   * 啟動本地策略
   * @param {Object} options - 啟動設定
   */
  async online(options = {}) {
    state.config = buildConfig(options);

    // 檢查 Express app 是否注入，避免插件自行開 server
    if (!options.expressApp) {
      state.lastError = new Error('缺少 Express app，無法註冊 IoT 路由');
      logger.error('[iotVisionTurret] 缺少 Express app，請由主服務注入');
      throw state.lastError;
    }

    // 註冊 IoT 路由（僅一次）
    registerRoutes(options.expressApp);

    const response = await runPython({ action: 'ping' }, state.config);
    state.online = true;
    state.lastError = null;
    state.lastResult = response;
    state.metrics.lastRunAt = new Date().toISOString();
    state.metrics.totalRuns += 1;
    logger.info('iotVisionTurret 本地策略已上線');
  },

  /**
   * 關閉本地策略
   */
  async offline() {
    state.online = false;
    state.lastError = null;
    // 裝置離線時清空狀態，避免殘留資料影響下次註冊
    deviceOnline = false;
    currentDeviceId = null;
    resetDeviceState('插件離線');
    logger.info('iotVisionTurret 本地策略已離線');
  },

  /**
   * 重啟本地策略
   * @param {Object} options - 重啟設定
   */
  async restart(options = {}) {
    await this.offline();
    await this.online(options);
  },

  /**
   * 回傳目前服務狀態
   * @returns {Promise<number>} 狀態碼：1=online, 0=offline, -1=error
   */
  async state() {
    return state.online ? 1 : 0;
  },

  /**
   * 傳送資料給 Python runner 並取得結果
   * @param {Object} data - 影像辨識或控制指令參數
   * @returns {Promise<Object>} 僅回傳 { ok:true } 或 { ok:false }
   */
  async send(data = {}) {
    // ───────────────────────────────────────────────
    // 段落用途：包覆完整流程，統一處理錯誤並回傳固定格式
    // ───────────────────────────────────────────────
    try {
      // ───────────────────────────────────────────────
      // 段落用途：檢查插件是否上線
      // ───────────────────────────────────────────────
      if (!state.online) {
        logger.warn('[iotVisionTurret] send 拒絕：插件尚未上線');
        return { ok: false };
      }

      // ───────────────────────────────────────────────
      // 段落用途：前置拒絕條件（jobLock）
      // ───────────────────────────────────────────────
      if (jobLock === true) {
        logger.warn('[iotVisionTurret] send 拒絕：jobLock 為 true');
        return { ok: false };
      }

      // ───────────────────────────────────────────────
      // 段落用途：前置拒絕條件（裝置在線狀態）
      // ───────────────────────────────────────────────
      if (!currentDeviceId || deviceOnline === false) {
        logger.warn('[iotVisionTurret] send 拒絕：裝置離線或尚未註冊');
        return { ok: false };
      }

      // ───────────────────────────────────────────────
      // 段落用途：取得 jobLock，確保單一時刻僅一個任務執行
      // ───────────────────────────────────────────────
      jobLock = true;
      logger.info('[iotVisionTurret] jobLock 已取得，開始執行掃描/追蹤流程');

      // ───────────────────────────────────────────────
      // 段落用途：初始化全域逾時與追蹤變數
      // ───────────────────────────────────────────────
      const deadline = Date.now() + TASK_TIMEOUT_MS;
      let currentYaw = 0;
      let currentPitch = 0;
      let lastYoloResult = null;

      // ───────────────────────────────────────────────
      // 段落用途：格點掃描流程（pitch 外圈、yaw 內圈）
      // ───────────────────────────────────────────────
      let foundInScan = false;
      for (const pitch of SCAN_PITCH_LIST) {
        for (const yaw of SCAN_YAW_LIST) {
          // ───────────────────────────────────────────────
          // 段落用途：檢查全域逾時（掃描階段）
          // ───────────────────────────────────────────────
          const remainingBeforeScan = getRemainingMs(deadline);
          if (remainingBeforeScan <= 0) {
            logger.warn('[iotVisionTurret] TASK_TIMEOUT：掃描階段逾時');
            return { ok: false };
          }

          // ───────────────────────────────────────────────
          // 段落用途：依序 enqueue move 指令並確保角度在 0~180
          // ───────────────────────────────────────────────
          currentYaw = clamp(yaw, 0, 180);
          currentPitch = clamp(pitch, 0, 180);
          enqueueCommand({
            type: 'move',
            yaw: currentYaw,
            pitch: currentPitch
          });

          // ───────────────────────────────────────────────
          // 段落用途：產生影像 ID 並 enqueue capture 指令
          // ───────────────────────────────────────────────
          const imageId = buildImageId();
          enqueueCommand({
            type: 'capture',
            image_id: imageId
          });

          // ───────────────────────────────────────────────
          // 段落用途：等待影像上傳完成（含 UPLOAD_TIMEOUT）
          // ───────────────────────────────────────────────
          const remainingForUpload = getRemainingMs(deadline);
          if (remainingForUpload <= 0) {
            logger.warn(`[iotVisionTurret] TASK_TIMEOUT：等待影像 ${imageId} 上傳逾時`);
            return { ok: false };
          }
          const uploadTimeoutMs = Math.min(UPLOAD_TIMEOUT_MS, remainingForUpload);
          let imagePath = '';
          try {
            imagePath = await waitForImage(imageId, uploadTimeoutMs);
          } catch (err) {
            const isTimeoutError =
              err &&
              (err.code === 'ETIMEDOUT' ||
                err.name === 'TimeoutError' ||
                err.message?.toLowerCase().includes('timeout'));
            if (isTimeoutError) {
              logger.warn(`[iotVisionTurret] UPLOAD_TIMEOUT：影像 ${imageId} 等待逾時 (${err.message})`);
            } else {
              logger.warn(`[iotVisionTurret] UPLOAD_FAILED：影像 ${imageId} 等待失敗 (${err && err.message})`);
            }
            return { ok: false };
          }

          // ───────────────────────────────────────────────
          // 段落用途：呼叫 YOLO 推理（掃描階段）
          // ───────────────────────────────────────────────
          const remainingForInfer = getRemainingMs(deadline);
          if (remainingForInfer <= 0) {
            logger.warn('[iotVisionTurret] TASK_TIMEOUT：YOLO 推理（掃描）逾時');
            return { ok: false };
          }
          const inferConfig = {
            ...state.config,
            timeoutMs: Math.min(state.config.timeoutMs, remainingForInfer)
          };
          let inferResult = null;
          try {
            inferResult = await runPython(
              { action: 'infer', payload: { image_id: imageId, image_path: imagePath, meta: data || {} } },
              inferConfig
            );
          } catch (err) {
            logger.error(`[iotVisionTurret] YOLO 推理失敗（掃描）：${err.message}`);
            return { ok: false };
          }

          // ───────────────────────────────────────────────
          // 段落用途：解析推理結果並判斷是否找到目標
          // ───────────────────────────────────────────────
          const normalized = normalizeYoloResult(inferResult);
          lastYoloResult = normalized;
          if (normalized.found) {
            logger.info(`[iotVisionTurret] 掃描找到目標：yaw=${currentYaw}, pitch=${currentPitch}, result=${JSON.stringify(normalized.raw)}`);
            foundInScan = true;
            break;
          }
        }
        if (foundInScan) {
          break;
        }
      }

      // ───────────────────────────────────────────────
      // 段落用途：掃描結束仍未找到目標
      // ───────────────────────────────────────────────
      if (!foundInScan) {
        logger.warn('[iotVisionTurret] 掃描完成仍未找到目標');
        return { ok: false };
      }

      // ───────────────────────────────────────────────
      // 段落用途：粗追蹤流程（最多 12 次）
      // ───────────────────────────────────────────────
      let lockStreak = 0;
      for (let iteration = 0; iteration < TRACK_MAX_ITERATIONS; iteration++) {
        // ───────────────────────────────────────────────
        // 段落用途：檢查全域逾時（追蹤階段）
        // ───────────────────────────────────────────────
        const remainingBeforeTrack = getRemainingMs(deadline);
        if (remainingBeforeTrack <= 0) {
          logger.warn('[iotVisionTurret] TASK_TIMEOUT：追蹤階段逾時');
          return { ok: false };
        }

        // ───────────────────────────────────────────────
        // 段落用途：取出目標中心點與影像尺寸，計算偏移誤差
        // ex/ey 符號定義：ex > 0 表示目標在畫面右側；ey > 0 表示目標在畫面下方
        // ───────────────────────────────────────────────
        const { center, imageSize, found } = lastYoloResult || {};
        if (!found) {
          logger.warn('[iotVisionTurret] 追蹤中斷：上一輪推理 found=false');
          return { ok: false };
        }
        if (!center || !imageSize) {
          logger.warn('[iotVisionTurret] 追蹤中斷：缺少 center 或 image_size');
          return { ok: false };
        }

        const width = Number(imageSize?.width ?? imageSize?.w ?? imageSize?.[0] ?? 0);
        const height = Number(imageSize?.height ?? imageSize?.h ?? imageSize?.[1] ?? 0);
        const cx = Number(center?.x ?? center?.[0] ?? 0);
        const cy = Number(center?.y ?? center?.[1] ?? 0);
        if (!width || !height) {
          logger.warn('[iotVisionTurret] 追蹤中斷：影像尺寸無效');
          return { ok: false };
        }

        const ex = cx - width / 2;
        const ey = cy - height / 2;

        // ───────────────────────────────────────────────
        // 段落用途：計算步進並更新 yaw/pitch
        // ───────────────────────────────────────────────
        const yawStep = clamp((ex / width) * YAW_GAIN_DEG, -YAW_MAX_STEP, YAW_MAX_STEP);
        const pitchStep = clamp((ey / height) * PITCH_GAIN_DEG, -PITCH_MAX_STEP, PITCH_MAX_STEP);
        currentYaw = clamp(currentYaw + yawStep, 0, 180);
        currentPitch = clamp(currentPitch + pitchStep, 0, 180);

        // ───────────────────────────────────────────────
        // 段落用途：enqueue move/capture 並等待影像上傳與推理
        // ───────────────────────────────────────────────
        enqueueCommand({
          type: 'move',
          yaw: currentYaw,
          pitch: currentPitch
        });

        const trackImageId = buildImageId();
        enqueueCommand({
          type: 'capture',
          image_id: trackImageId
        });

        const remainingForTrackUpload = getRemainingMs(deadline);
        if (remainingForTrackUpload <= 0) {
          logger.warn(`[iotVisionTurret] TASK_TIMEOUT：追蹤影像 ${trackImageId} 上傳逾時`);
          return { ok: false };
        }
        const trackUploadTimeout = Math.min(UPLOAD_TIMEOUT_MS, remainingForTrackUpload);
        let trackImagePath = '';
        try {
          trackImagePath = await waitForImage(trackImageId, trackUploadTimeout);
        } catch (err) {
          const isTimeoutError =
            err &&
            (err.code === 'ETIMEDOUT' ||
              err.name === 'TimeoutError' ||
              err.message?.toLowerCase().includes('timeout'));
          if (isTimeoutError) {
            logger.warn(`[iotVisionTurret] UPLOAD_TIMEOUT：追蹤影像 ${trackImageId} 等待逾時 (${err.message})`);
          } else {
            logger.warn(`[iotVisionTurret] UPLOAD_FAILED：追蹤影像 ${trackImageId} 等待失敗 (${err && err.message})`);
          }
          return { ok: false };
        }

        const remainingForTrackInfer = getRemainingMs(deadline);
        if (remainingForTrackInfer <= 0) {
          logger.warn('[iotVisionTurret] TASK_TIMEOUT：YOLO 推理（追蹤）逾時');
          return { ok: false };
        }
        const trackInferConfig = {
          ...state.config,
          timeoutMs: Math.min(state.config.timeoutMs, remainingForTrackInfer)
        };
        let trackInferResult = null;
        try {
          trackInferResult = await runPython(
            { action: 'infer', payload: { image_id: trackImageId, image_path: trackImagePath, meta: data || {} } },
            trackInferConfig
          );
        } catch (err) {
          logger.error(`[iotVisionTurret] YOLO 推理失敗（追蹤）：${err.message}`);
          return { ok: false };
        }

        // ───────────────────────────────────────────────
        // 段落用途：判斷追蹤推理結果與收斂狀態
        // ───────────────────────────────────────────────
        const trackNormalized = normalizeYoloResult(trackInferResult);
        lastYoloResult = trackNormalized;
        if (!trackNormalized.found) {
          logger.warn('[iotVisionTurret] 追蹤推理 found=false，立即中止');
          return { ok: false };
        }

        // ───────────────────────────────────────────────
        // 段落用途：以最新推理結果計算 LOCKED 判定用的偏移
        // ───────────────────────────────────────────────
        const lockCenter = trackNormalized.center ?? null;
        const lockImageSize = trackNormalized.imageSize ?? null;
        if (!lockCenter || !lockImageSize) {
          logger.warn('[iotVisionTurret] LOCKED 判定失敗：缺少 center 或 image_size');
          return { ok: false };
        }

        const lockWidth = Number(lockImageSize?.width ?? lockImageSize?.w ?? lockImageSize?.[0] ?? 0);
        const lockHeight = Number(lockImageSize?.height ?? lockImageSize?.h ?? lockImageSize?.[1] ?? 0);
        const lockCx = Number(lockCenter?.x ?? lockCenter?.[0] ?? 0);
        const lockCy = Number(lockCenter?.y ?? lockCenter?.[1] ?? 0);
        if (!lockWidth || !lockHeight) {
          logger.warn('[iotVisionTurret] LOCKED 判定失敗：影像尺寸無效');
          return { ok: false };
        }

        const lockEx = lockCx - lockWidth / 2;
        const lockEy = lockCy - lockHeight / 2;

        if (Math.abs(lockEx) < LOCKED_CONVERGENCE_THRESHOLD && Math.abs(lockEy) < LOCKED_CONVERGENCE_THRESHOLD) {
          lockStreak += 1;
          logger.info(`[iotVisionTurret] LOCKED 判定命中：streak=${lockStreak}`);
        } else {
          lockStreak = 0;
          logger.info('[iotVisionTurret] LOCKED 判定未命中，streak 重置為 0');
        }

        if (lockStreak >= LOCK_STREAK) {
          // ───────────────────────────────────────────────
          // 段落用途：LOCKED 後只負責將 IR 指令排入佇列，並立即返回
          // 注意：此處回傳 ok=true 代表指令已成功佇列，並不保證實際已在裝置上執行完成
          // ───────────────────────────────────────────────
          enqueueCommand({
            type: 'ir_send',
            profile: 'LIGHT_ON'
          });
          logger.info('[iotVisionTurret] LOCKED 成功，IR 指令已排入佇列（不保證已於裝置端執行完成）');
          return { ok: true };
        }
      }

      // ───────────────────────────────────────────────
      // 段落用途：追蹤迭代結束仍未 LOCKED
      // ───────────────────────────────────────────────
      logger.warn('[iotVisionTurret] 追蹤完成仍未達成 LOCKED');
      return { ok: false };
    } catch (err) {
      // ───────────────────────────────────────────────
      // 段落用途：捕捉未預期錯誤並回傳固定格式
      // ───────────────────────────────────────────────
      logger.error(`[iotVisionTurret] send 發生未預期錯誤：${err.message}`);
      return { ok: false };
    } finally {
      // ───────────────────────────────────────────────
      // 段落用途：無論成功或失敗，確保 jobLock 被釋放
      // ───────────────────────────────────────────────
      if (jobLock) {
        jobLock = false;
        logger.info('[iotVisionTurret] jobLock 已釋放');
      }
    }
  },

  /**
   * 等待指定影像上傳完成
   * @param {string} imageId - 影像 ID
   * @param {number} timeoutMs - 逾時時間
   * @returns {Promise<string>} 影像路徑
   */
  async waitImage(imageId, timeoutMs = 30000) {
    return waitForImage(imageId, timeoutMs);
  }
};
