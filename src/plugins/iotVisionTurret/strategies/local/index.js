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
    timeoutMs: 15000,
    yoloWeightsPath: process.env.YOLO_WEIGHTS_PATH || '',
    yoloTarget: process.env.YOLO_TARGET || '',
    yoloConf: Number.isFinite(Number(process.env.YOLO_CONF)) ? Number(process.env.YOLO_CONF) : 0.25,
    yoloInferTimeoutMs: 12000 // Default YOLO inference timeout, can be overridden by buildConfig
  },
  metrics: {
    lastRunAt: null,
    totalRuns: 0
  }
};

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
// 注意：掃描階段最多執行 5×5=25 個格點，每格需執行 move、capture、upload 與推理
// 若 UPLOAD_TIMEOUT_MS=5000 且推理平均需時 2-3 秒，完整掃描最壞情況可能需 200+ 秒
// 當前設定 45 秒是基於以下假設：
// - 大多數情況下會在前幾個格點即找到目標，提前結束掃描
// - 實際應用場景中，目標通常出現在預期區域附近
// 若需完整掃描支援，請調整為 TASK_TIMEOUT_MS = 300000（5 分鐘）或更高
const TASK_TIMEOUT_MS = 300000;
// 單張影像上傳等待逾時（ms）
const UPLOAD_TIMEOUT_MS = 5000;
// 掃描 pitch 序列（外圈）
// 注意：pitch 在本裝置上僅安全支援到約 120 度，因機械結構限制
// 若未來機構/伺服馬達可支援完整 0–180 度，請一併調整此列表與相關參數
const SCAN_PITCH_LIST = [0];
// 掃描 yaw 序列（內圈，允許完整 0–180 度掃描）
const SCAN_YAW_LIST = [0, 45, 90, 0];
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
// YOLO 推理逾時（ms），避免單次推理卡死影響整體流程
const YOLO_INFER_TIMEOUT_MS = 12000;

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
 * 合併與驗證設定
 * @param {Object} options - 來源設定
 * @returns {Object} 合併後設定
 */
function buildConfig(options = {}) {
  return {
    pythonPath: options.pythonPath !== undefined ? options.pythonPath : state.config.pythonPath,
    runnerPath: options.runnerPath !== undefined ? options.runnerPath : state.config.runnerPath,
    timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : state.config.timeoutMs,
    yoloWeightsPath: options.yoloWeightsPath !== undefined ? options.yoloWeightsPath : state.config.yoloWeightsPath,
    yoloTarget: options.yoloTarget !== undefined ? options.yoloTarget : state.config.yoloTarget,
    yoloConf: Number.isFinite(options.yoloConf) ? options.yoloConf : state.config.yoloConf,
    yoloInferTimeoutMs: Number.isFinite(options.yoloInferTimeoutMs)
      ? options.yoloInferTimeoutMs
      : state.config.yoloInferTimeoutMs
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
 * 
 * 指令格式說明：
 * - v0.3 起採用扁平化指令格式，直接包含 type 與參數欄位
 * - move 指令：{ type: 'move', yaw: number, pitch: number }
 * - capture 指令：{ type: 'capture', image_id: string }
 * - ir_send 指令：{ type: 'ir_send', profile: string }
 * - 裝置端需支援此格式，舊版 { command, payload, queuedAt } 格式已廢棄
 * 
 * @param {Object} command - 指令內容（需包含 type 欄位）
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
    // 段落用途：若影像已存在則直接回傳，避免重複等待並讓 imageStore 作為後續讀檔索引
    if (imageStore.has(imageId)) {
      logger.info(`[iotVisionTurret] 影像已存在，立即回傳：${imageId}`);
      return resolve(imageStore.get(imageId));
    }

    // 段落用途：若已有等待者則拒絕重複等待，避免同一 image_id 產生多個 Promise 造成同步混亂
    if (imageWaiters.has(imageId)) {
      logger.warn(`[iotVisionTurret] 影像等待重複申請：${imageId}`);
      return reject(new Error(`影像 ${imageId} 已有等待者，拒絕重複等待`));
    }

    // 段落用途：建立逾時計時器，逾時必須 reject，避免流程永遠等待並確保資源可回收
    const timer = setTimeout(() => {
      // 段落用途：逾時後清理 Map，避免 memory leak
      imageWaiters.delete(imageId);
      logger.warn(`[iotVisionTurret] 影像等待逾時：${imageId}，timeout=${timeoutMs}ms`);
      const timeoutError = new Error(`UPLOAD_TIMEOUT: ${imageId} (${timeoutMs}ms)`);
      timeoutError.code = 'UPLOAD_TIMEOUT';
      reject(timeoutError);
    }, timeoutMs);

    // 段落用途：建立 imageWaiters，作為 capture → upload 的同步橋接
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

  // 段落用途：統一拋出錯誤訊息供上層判斷，避免流程默默失敗
  const error = new Error('不支援的 Content-Type，僅支援 application/octet-stream 或 image/*');
  error.code = 'UNSUPPORTED_CONTENT_TYPE';
  throw error;
}

/**
 * 確保上傳資料夾存在
 */
async function ensureUploadDir() {
  // 段落用途：建立上傳目錄，避免寫入時出錯並確保部署差異不影響上傳流程
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

    // 段落用途：檢查是否有等待此影像的流程
    // 注意：當 send() 執行掃描流程並持有 jobLock 時，裝置會上傳影像
    // 此時不應拒絕上傳，而是檢查該 imageId 是否有對應的 waiter
    // 若有 waiter 或 imageId 已在 imageStore 中，則允許上傳（可能是掃描流程要求的）
    const hasWaiter = imageWaiters.has(imageId);
    const hasExistingImage = imageStore.has(imageId);

    // 僅在沒有任何等待者、也沒有既有影像、且 jobLock 被其他上傳持有時才拒絕
    // 這樣可避免掃描流程發出 capture 後，裝置上傳卻被自己的 jobLock 擋住
    if (!hasWaiter && !hasExistingImage && jobLock) {
      logger.warn(`[iotVisionTurret] 上傳被鎖定，拒絕影像 ${imageId}（無對應等待者）`);
      return sendError(res, 409, '目前有其他上傳作業進行中，且無此影像的等待者');
    }

    try {
      // 段落用途：允許重複 image_id 時覆蓋，符合裝置重送常態
      if (imageStore.has(imageId)) {
        logger.warn(`[iotVisionTurret] 重複 image_id，將覆蓋既有檔案：${imageId}`);

        // 若先前已存在等待同一 imageId 的 waiter，先行拒絕並清理，避免覆蓋造成同步問題
        const existingWaiter = imageWaiters.get(imageId);
        if (existingWaiter) {
          try {
            existingWaiter.reject(
              new Error(`image_id ${imageId} 被新的上傳請求覆蓋`)
            );
          } catch (waiterErr) {
            logger.warn(
              `[iotVisionTurret] 拒絕既有影像等待者時發生錯誤：${imageId} - ${waiterErr.message}`
            );
          }
          clearTimeout(existingWaiter.timer);
          imageWaiters.delete(imageId);
          logger.warn(`[iotVisionTurret] 既有影像等待者已因覆蓋而取消：${imageId}`);
        }
      }

      // 段落用途：檢查並解析上傳內容，必要時拋出錯誤以返回正確狀態碼
      const imageBuffer = extractUploadBuffer(req);
      if (!imageBuffer || imageBuffer.length === 0) {
        logger.warn('[iotVisionTurret] 上傳內容為空');
        return sendError(res, 400, '上傳內容不可為空');
      }

      // 段落用途：上傳前確保 artifacts 目錄存在，避免部署差異導致寫入失敗
      await ensureUploadDir();
      const filePath = path.join(UPLOAD_DIR, `${imageId}.jpg`);
      await fs.promises.writeFile(filePath, imageBuffer);

      // 段落用途：更新 imageStore，提供後續推理或追蹤流程讀取檔案路徑
      imageStore.set(imageId, filePath);
      logger.info(`[iotVisionTurret] 影像已儲存：${filePath}`);

      // 段落用途：若存在 imageWaiters，立即 resolve 並清理 timer 與 Map，避免 race condition 與記憶體洩漏
      const waiter = imageWaiters.get(imageId);
      if (waiter) {
        waiter.resolve(filePath);
        clearTimeout(waiter.timer);
        imageWaiters.delete(imageId);
        logger.info(`[iotVisionTurret] 影像等待者已解除：${imageId}`);
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      // 段落用途：集中處理上傳錯誤，避免流程默默卡住並提供可追蹤 log
      if (err && err.code === 'UNSUPPORTED_CONTENT_TYPE') {
        logger.warn(`[iotVisionTurret] 上傳失敗：不支援的 Content-Type (${err.message})`);
        return sendError(res, 415, '不支援的 Content-Type');
      }
      logger.error(`[iotVisionTurret] 影像上傳失敗：${err.message}`);
      return sendError(res, 500, err.message);
    }
    // 注意：此處移除原有的 finally { jobLock = false; }
    // 因為 upload 路由不應控制 jobLock，jobLock 是 send() 掃描/追蹤流程的專屬鎖
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
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
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

/**
 * 以子進程呼叫 YOLO 推理並回傳結果
 * @param {string} imagePath - 影像路徑
 * @param {number} maxTimeoutMs - 最大超時時間（毫秒），用於遵守全域任務期限
 * @returns {Promise<Object>} 成功回傳 { ok:true, payload }，失敗回傳 { ok:false }
 */
async function runYoloInfer(imagePath, maxTimeoutMs) {
  // ───────────────────────────────────────────────
  // 段落用途：組裝推理所需設定與輸入摘要（避免重複寫死在多處）
  // ───────────────────────────────────────────────
  const weightsPath = state.config.yoloWeightsPath;
  const target = state.config.yoloTarget;
  const conf = state.config.yoloConf;
  const configuredTimeoutMs = Number.isFinite(state.config.yoloInferTimeoutMs)
    ? state.config.yoloInferTimeoutMs
    : YOLO_INFER_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(maxTimeoutMs)
    ? Math.max(0, Math.min(configuredTimeoutMs, maxTimeoutMs))
    : configuredTimeoutMs;

  // 基本設定檢查：避免將空的權重路徑或目標傳給 Python runner，造成不明錯誤
  if (!weightsPath || !target) {
    const errorMessage = 'YOLO 推理設定缺失：yoloWeightsPath 或 yoloTarget 未設定或為空字串';
    logger.error(errorMessage, {
      imagePath,
      yoloWeightsPath: weightsPath,
      yoloTarget: target
    });
    return {
      ok: false,
      error: errorMessage,
      detail: {
        imagePath,
        yoloWeightsPath: weightsPath,
        yoloTarget: target
      }
    };
  }

  const inputSummary = {
    imagePath,
    weightsPath,
    target,
    conf
  };

  // ───────────────────────────────────────────────
  // 段落用途：使用 spawn 呼叫 Python，便於精準控制 stdin/stdout/stderr 與 EOF
  // ───────────────────────────────────────────────
  return new Promise((resolve) => {
    const processArgs = [state.config.runnerPath];
    const child = spawn(state.config.pythonPath, processArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    // ───────────────────────────────────────────────
    // 段落用途：設定推理逾時，逾時即 kill 子進程並回傳 { ok:false }
    // ───────────────────────────────────────────────
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      logger.error(`[iotVisionTurret] YOLO 推理逾時：${JSON.stringify({ imagePath })}`);
      resolve({ ok: false });
    }, timeoutMs);

    // ───────────────────────────────────────────────
    // 段落用途：收集 stdout，必須等到 close 後再 parse
    // ───────────────────────────────────────────────
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    // ───────────────────────────────────────────────
    // 段落用途：收集 stderr，供 exit code 非 0 或錯誤時記錄
    // ───────────────────────────────────────────────
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    // ───────────────────────────────────────────────
    // 段落用途：子進程錯誤事件（例如無法啟動 Python），映射為 { ok:false }
    // ───────────────────────────────────────────────
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      logger.error(`[iotVisionTurret] YOLO 推理子進程錯誤：${err.message}`);
      resolve({ ok: false });
    });

    // ───────────────────────────────────────────────
    // 段落用途：close 事件代表 stdout/stderr 已完整輸出，可安全解析 JSON
    // ───────────────────────────────────────────────
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      // ───────────────────────────────────────────────
      // 段落用途：exit code 非 0 視為失敗並記錄錯誤資訊，回傳 { ok:false }
      // ───────────────────────────────────────────────
      if (code !== 0) {
        logger.error(
          `[iotVisionTurret] YOLO 推理非正常結束：${JSON.stringify({
            code,
            stderr: stderr || null,
            input: inputSummary
          })}`
        );
        resolve({ ok: false });
        return;
      }

      // ───────────────────────────────────────────────
      // 段落用途：解析 stdout JSON（假設 stdout 僅輸出單一 JSON）
      // 禁止分段解析，避免非 JSON 混入造成誤判
      // ───────────────────────────────────────────────
      try {
        const trimmed = stdout.trim();
        const parsed = trimmed ? JSON.parse(trimmed) : {};
        const errorCode = parsed?.error_code;
        const isExplicitFailure =
          parsed?.ok === false ||
          (typeof errorCode === 'string' && errorCode.length > 0);
        if (isExplicitFailure) {
          // ───────────────────────────────────────────────
          // 段落用途：Python 明確回傳失敗，統一映射為 { ok:false }
          // ───────────────────────────────────────────────
          logger.error(
            `[iotVisionTurret] YOLO 推理回傳失敗：${JSON.stringify({
              errorCode: errorCode || null,
              message: parsed?.message || parsed?.error?.message || null
            })}`
          );
          resolve({ ok: false });
          return;
        }
        resolve({ ok: true, payload: parsed });
      } catch (err) {
        // ───────────────────────────────────────────────
        // 段落用途：stdout JSON 解析失敗，回傳 { ok:false } 並記錄原始輸出
        // ───────────────────────────────────────────────
        const preview = stdout.length > 500 ? `${stdout.slice(0, 500)}...` : stdout;
        logger.error(
          `[iotVisionTurret] YOLO 推理 JSON 解析失敗：${JSON.stringify({
            error: err.message,
            stdout: preview
          })}`
        );
        resolve({ ok: false });
      }
    });

    // ───────────────────────────────────────────────
    // 段落用途：以 stdin 傳入 JSON 指令並確實 end()，避免 Python 等待 EOF
    // ───────────────────────────────────────────────
    try {
      const payload = {
        action: 'infer',
        payload: {
          image_path: imagePath,
          weights_path: weightsPath,
          target,
          conf
        }
      };
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      logger.error(`[iotVisionTurret] YOLO 推理 stdin 寫入失敗：${err.message}`);
      resolve({ ok: false });
    }
  });
}

// ───────────────────────────────────────────────
// 演算法一：原本的批次處理方式（掃描找到目標後追蹤，最後發送IR）
// @param {number} deadline - 任務截止時間
// @param {string} irProfile - IR 指令類型（'LIGHT_ON' 或 'LIGHT_OFF'）
// ───────────────────────────────────────────────
async function algorithmBatchProcess(deadline, irProfile = 'LIGHT_ON') {
  let currentYaw = 0;
  let currentPitch = 0;
  let lastYoloResult = null;

  // ───────────────────────────────────────────────
  // 段落用途：格點掃描流程（pitch 外圈、yaw 內圈）
  // ───────────────────────────────────────────────
  let foundInScan = false;
  for (const pitch of SCAN_PITCH_LIST) {
    for (const yaw of SCAN_YAW_LIST) {
      const remainingBeforeScan = getRemainingMs(deadline);
      if (remainingBeforeScan <= 0) {
        logger.warn('[iotVisionTurret] TASK_TIMEOUT：掃描階段逾時');
        return { ok: false };
      }

      currentYaw = clamp(yaw, 0, 180);
      currentPitch = clamp(pitch, 0, 180);
      enqueueCommand({
        type: 'move',
        yaw: currentYaw,
        pitch: currentPitch
      });

      const imageId = buildImageId();
      enqueueCommand({
        type: 'capture',
        image_id: imageId
      });

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
          (err.code === 'UPLOAD_TIMEOUT' ||
            err.code === 'ETIMEDOUT' ||
            err.name === 'TimeoutError' ||
            err.message?.toLowerCase().includes('timeout') ||
            err.message?.toLowerCase().includes('upload_timeout'));
        if (isTimeoutError) {
          logger.warn(`[iotVisionTurret] UPLOAD_TIMEOUT：影像 ${imageId} 等待逾時 (${err.message})`);
        } else {
          logger.warn(`[iotVisionTurret] UPLOAD_FAILED：影像 ${imageId} 等待失敗 (${err && err.message})`);
        }
        return { ok: false };
      }

      const remainingForInfer = getRemainingMs(deadline);
      if (remainingForInfer <= 0) {
        logger.warn('[iotVisionTurret] TASK_TIMEOUT：YOLO 推理（掃描）逾時');
        return { ok: false };
      }

      const inferResult = await runYoloInfer(imagePath, remainingForInfer);
      if (!inferResult || inferResult.ok !== true) {
        logger.error('[iotVisionTurret] YOLO 推理失敗（掃描）：runYoloInfer 回傳 ok=false');
        return { ok: false };
      }

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

  if (!foundInScan) {
    logger.warn('[iotVisionTurret] 掃描完成仍未找到目標');
    return { ok: false };
  }

  // ───────────────────────────────────────────────
  // 段落用途：粗追蹤流程（最多 12 次）
  // ───────────────────────────────────────────────
  let lockStreak = 0;
  for (let iteration = 0; iteration < TRACK_MAX_ITERATIONS; iteration++) {
    const remainingBeforeTrack = getRemainingMs(deadline);
    if (remainingBeforeTrack <= 0) {
      logger.warn('[iotVisionTurret] TASK_TIMEOUT：追蹤階段逾時');
      return { ok: false };
    }

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

    if (Math.abs(ex) < LOCKED_CONVERGENCE_THRESHOLD && Math.abs(ey) < LOCKED_CONVERGENCE_THRESHOLD) {
      lockStreak += 1;
      logger.info(`[iotVisionTurret] LOCKED 判定命中：streak=${lockStreak}`);
      
      if (lockStreak >= LOCK_STREAK) {
        enqueueCommand({
          type: 'ir_send',
          profile: irProfile
        });
        logger.info(`[iotVisionTurret] LOCKED 成功，IR 指令 (${irProfile}) 已排入佇列`);
        return { ok: true, irProfile };
      }
    } else {
      lockStreak = 0;
      logger.info('[iotVisionTurret] LOCKED 判定未命中，streak 重置為 0');
    }

    const yawStep = clamp((ex / width) * YAW_GAIN_DEG, -YAW_MAX_STEP, YAW_MAX_STEP);
    const pitchStep = clamp((ey / height) * PITCH_GAIN_DEG, -PITCH_MAX_STEP, PITCH_MAX_STEP);
    currentYaw = clamp(currentYaw + yawStep, 0, 180);
    currentPitch = clamp(currentPitch + pitchStep, 0, 180);

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
        (err.code === 'UPLOAD_TIMEOUT' ||
          err.code === 'ETIMEDOUT' ||
          err.name === 'TimeoutError' ||
          err.message?.toLowerCase().includes('timeout') ||
          err.message?.toLowerCase().includes('upload_timeout'));
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

    const trackInferResult = await runYoloInfer(trackImagePath, remainingForTrackInfer);
    if (!trackInferResult || trackInferResult.ok !== true) {
      logger.error('[iotVisionTurret] YOLO 推理失敗（追蹤）：runYoloInfer 回傳 ok=false');
      return { ok: false };
    }

    const trackNormalized = normalizeYoloResult(trackInferResult);
    lastYoloResult = trackNormalized;
    if (!trackNormalized.found) {
      logger.warn('[iotVisionTurret] 追蹤推理 found=false，立即中止');
      return { ok: false };
    }
  }

  logger.warn('[iotVisionTurret] 追蹤完成仍未達成 LOCKED');
  return { ok: false };
}

// ───────────────────────────────────────────────
// 演算法二：逐步發送方式（每轉一次就發送一次 IR 並拍照）
// 假設轉 N 次，就會發送 N 次 IR 並拍 N 張照
// @param {number} deadline - 任務截止時間
// @param {string} irProfile - IR 指令類型（'LIGHT_ON' 或 'LIGHT_OFF'）
// ───────────────────────────────────────────────
async function algorithmStepByStepIR(deadline, irProfile = 'LIGHT_ON') {
  let currentYaw = 0;
  let currentPitch = 0;
  let totalIRSent = 0;
  let totalCaptured = 0;

  // ───────────────────────────────────────────────
  // 段落用途：格點掃描流程，每個格點都執行：移動 -> 發送IR -> 拍照
  // ───────────────────────────────────────────────

  for (const pitch of SCAN_PITCH_LIST) {
    for (const yaw of SCAN_YAW_LIST) {
      const remainingBeforeScan = getRemainingMs(deadline);
      if (remainingBeforeScan <= 0) {
        logger.warn(`[iotVisionTurret] TASK_TIMEOUT：逐步掃描階段逾時，已發送 ${totalIRSent} 次 IR，已拍 ${totalCaptured} 張照`);
        return { ok: false, totalIRSent, totalCaptured };
      }

      // ───────────────────────────────────────────────
      // 步驟 1：移動到目標位置
      // ───────────────────────────────────────────────
      currentYaw = clamp(yaw, 0, 180);
      currentPitch = clamp(pitch, 0, 180);
      enqueueCommand({
        type: 'move',
        yaw: currentYaw,
        pitch: currentPitch
      });
      logger.info(`[iotVisionTurret] 逐步模式：移動到 yaw=${currentYaw}, pitch=${currentPitch}`);

      // ───────────────────────────────────────────────
      // 步驟 2：發送 IR 指令
      // ───────────────────────────────────────────────
      enqueueCommand({
        type: 'ir_send',
        profile: irProfile
      });
      totalIRSent++;
      logger.info(`[iotVisionTurret] 逐步模式：第 ${totalIRSent} 次 IR (${irProfile}) 已排入佇列`);

      // ───────────────────────────────────────────────
      // 步驟 3：拍照並等待上傳
      // ───────────────────────────────────────────────
      const imageId = buildImageId();
      enqueueCommand({
        type: 'capture',
        image_id: imageId
      });

      const remainingForUpload = getRemainingMs(deadline);
      if (remainingForUpload <= 0) {
        logger.warn(`[iotVisionTurret] TASK_TIMEOUT：等待影像 ${imageId} 上傳逾時`);
        return { ok: false, totalIRSent, totalCaptured };
      }
      const uploadTimeoutMs = Math.min(UPLOAD_TIMEOUT_MS, remainingForUpload);
      
      try {
        const imagePath = await waitForImage(imageId, uploadTimeoutMs);
        totalCaptured++;
        logger.info(`[iotVisionTurret] 逐步模式：第 ${totalCaptured} 張照片已儲存：${imagePath}`);
      } catch (err) {
        const isTimeoutError =
          err &&
          (err.code === 'UPLOAD_TIMEOUT' ||
            err.code === 'ETIMEDOUT' ||
            err.name === 'TimeoutError' ||
            err.message?.toLowerCase().includes('timeout') ||
            err.message?.toLowerCase().includes('upload_timeout'));
        if (isTimeoutError) {
          logger.warn(`[iotVisionTurret] UPLOAD_TIMEOUT：影像 ${imageId} 等待逾時 (${err.message})`);
        } else {
          logger.warn(`[iotVisionTurret] UPLOAD_FAILED：影像 ${imageId} 等待失敗 (${err && err.message})`);
        }
        // 拍照失敗不中斷流程，繼續下一個格點
        logger.info(`[iotVisionTurret] 逐步模式：拍照失敗，繼續下一個格點`);
      }

      // 可選：加入短暫延遲讓裝置有時間執行（避免指令堆積過快）
      // await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  logger.info(`[iotVisionTurret] 逐步模式完成：總共發送 ${totalIRSent} 次 IR (${irProfile})，拍攝 ${totalCaptured} 張照片`);
  return { ok: true, totalIRSent, totalCaptured, irProfile };
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

    // 段落用途：插件上線時先建立 artifacts 目錄，較早發現部署問題並確保上傳流程不被卡住
    try {
      await ensureUploadDir();
      logger.info(`[iotVisionTurret] 已確認上傳目錄存在：${UPLOAD_DIR}`);
    } catch (err) {
      logger.error(`[iotVisionTurret] 建立上傳目錄失敗：${err.message}`);
      throw err;
    }

    // 註：移除 ping 測試，Python runner 僅支援 infer 操作
    state.online = true;
    state.lastError = null;
    state.lastResult = null;
    state.metrics.lastRunAt = new Date().toISOString();
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
    let acquiredLock = false;
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
      acquiredLock = true;
      logger.info('[iotVisionTurret] jobLock 已取得，開始執行掃描/追蹤流程');

      // ───────────────────────────────────────────────
      // 段落用途：初始化全域逾時
      // ───────────────────────────────────────────────
      const deadline = Date.now() + TASK_TIMEOUT_MS;

      // ───────────────────────────────────────────────
      // 段落用途：從 LLM input 判斷開燈或關燈
      // 支援的指令：
      // - 開燈：'on', 'open', '開燈', '開', '打開' 等
      // - 關燈：'off', 'close', '關燈', '關', '關閉' 等
      // 預設為開燈 (LIGHT_ON)
      // ───────────────────────────────────────────────
      const inputRaw = typeof data.input === 'string' ? data.input.toLowerCase().trim() : '';
      const offKeywords = ['off', 'close', '關燈', '關', '關閉', '熄燈', '關掉', '熄滅'];
      const isOff = offKeywords.some(keyword => inputRaw.includes(keyword));
      const irProfile = isOff ? 'LIGHT_OFF' : 'LIGHT_ON';
      logger.info(`[iotVisionTurret] LLM 輸入："${data.input || '(無)'}"，判定 IR 指令：${irProfile}`);

      // ───────────────────────────────────────────────
      // 演算法選擇：
      // 第一種：原本的批次處理方式（掃描找到目標後追蹤，最後發送IR）
      // 第二種：逐步發送方式（每轉一次就發送一次 IR）
      // ───────────────────────────────────────────────

      // 演算法一：批次處理方式（已註解）
      // return await algorithmBatchProcess(deadline, irProfile);

      // 演算法二：逐步發送方式（目前啟用）
      return await algorithmStepByStepIR(deadline, irProfile);
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
      if (acquiredLock && jobLock) {
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
