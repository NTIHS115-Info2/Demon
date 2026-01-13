const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');

const pluginsManager = require('../../../../core/pluginsManager');
const talker = require('../../../../core/TalkToDemon');
const Logger = require('../../../../utils/logger');
const { generateUlid } = require('../../../../utils/ulid');

// ───────────────────────────────────────────────
// 區段：記錄器
// 用途：統一輸出語音流程的日誌
// ───────────────────────────────────────────────
const fallbackLogger = new Logger('appVoiceMessagePipeline');

// ───────────────────────────────────────────────
// 區段：固定參數
// 用途：集中管理路徑與限制條件
// ───────────────────────────────────────────────
const VOICE_INBOX_DIR = path.resolve(process.cwd(), 'artifacts', 'tmp', 'voice_inbox');
const VOICE_OUTBOX_DIR = path.resolve(process.cwd(), 'artifacts', 'tmp', 'voice_outbox');
const DEFAULT_LLM_TIMEOUT_MS = 60000;
const DEFAULT_TTS_WAIT_TIMEOUT_MS = 45000;
const DEFAULT_FFMPEG_TIMEOUT_MS = 30000;

// ───────────────────────────────────────────────
// 區段：TTS 重試設定
// 用途：確保 TTS 請求一定會完成，不會因為 ttsEngine 忙碌而失敗
// 說明：使用指數退避策略，逐漸增加等待時間
// ───────────────────────────────────────────────
const TTS_RETRY_CONFIG = {
  maxRetries: 30,           // 最多重試 30 次
  baseDelayMs: 500,         // 初始等待時間 500ms
  maxDelayMs: 5000,         // 最大等待時間 5 秒
  totalTimeoutMs: 120000,   // 總超時時間 2 分鐘
  backoffMultiplier: 1.5    // 指數退避倍數
};

// ───────────────────────────────────────────────
// 區段：驗證模式
// 用途：統一輸入驗證規則
// ───────────────────────────────────────────────
const USERNAME_PATTERN = /^[a-z0-9_.-]{1,64}$/;
const FILE_EXTENSION_PATTERN = /^\.[a-z0-9]+$/;

// ───────────────────────────────────────────────
// 區段：支援的音訊格式
// 用途：限制上傳格式，避免不支援的音訊造成流程錯誤
// 說明：audio/mp4 可容納視訊但通常用於 M4A 音訊容器，
//       audio/m4a 為 M4A 的正確 MIME 類型
// ───────────────────────────────────────────────
const SUPPORTED_MIME_TYPES = new Map([
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
  ['audio/m4a', '.m4a'],
  ['audio/mp4', '.m4a'], // MP4 容器，通常用於 M4A 音訊
  ['audio/mpeg', '.mp3'],
  ['audio/mp3', '.mp3'],
  ['audio/ogg', '.ogg'],
  ['audio/webm', '.webm'],
  ['audio/flac', '.flac']
]);

// ───────────────────────────────────────────────
// 區段：處理鎖
// 用途：避免相同 trace_id 併發重入
// 說明：定期清理過期鎖以避免記憶體洩漏
// ───────────────────────────────────────────────
const traceLocks = new Map();
const LOCK_CLEANUP_INTERVAL_MS = 60000; // 1 分鐘
const LOCK_MAX_AGE_MS = 600000; // 10 分鐘

// 定期清理過期鎖，使用 unref 避免阻止程序退出
const lockCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [traceId, timestamp] of traceLocks.entries()) {
    if (now - timestamp > LOCK_MAX_AGE_MS) {
      traceLocks.delete(traceId);
    }
  }
}, LOCK_CLEANUP_INTERVAL_MS);
if (lockCleanupInterval.unref) {
  lockCleanupInterval.unref();
}

// ───────────────────────────────────────────────
// 區段：LLM 請求序列化
// 用途：避免 talker 事件流混淆
// 說明：以下狀態為模組層級共享，所有 VoiceMessagePipeline 實例會共用
//       同一個 LLM 請求佇列，以「全域序列化」方式避免 talker 事件流互相干擾。
//       若改為每個實例各自持有佇列，將失去這個全域排序保證。
//       
//       序列化處理說明：
//       - 請求必須「依序執行」而非併發，因為 talker 是全域單例
//       - 使用 while 迴圈確保在處理期間加入的新請求也會被處理
//       - 使用 setImmediate 避免深度遞迴造成堆疊溢位
// ───────────────────────────────────────────────
let requestQueue = [];
let isProcessing = false;
let ttsFallbackWarningShown = false; // 避免重複警告造成日誌污染

function enqueueTalkerRequest(payload) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ ...payload, resolve, reject });
    // 此檢查在同步執行，isProcessing 設為 true 後才會進入 async 區段
    // 因此多個同步呼叫不會造成競態條件
    if (!isProcessing) {
      processNextTalkerRequest();
    }
  });
}

async function processNextTalkerRequest() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // 使用 while 迴圈而非單次處理，確保處理期間加入的請求也會被執行
    while (requestQueue.length > 0) {
      const task = requestQueue.shift();
      try {
        const result = await collectTalkerResponse(task);
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      }
    }
  } finally {
    isProcessing = false;
    // 若在處理完畢後又有新請求進入，使用 setImmediate 避免深度遞迴
    // setImmediate 將遞迴呼叫推遲到下一個事件循環，防止堆疊溢位
    if (requestQueue.length > 0) {
      setImmediate(processNextTalkerRequest);
    }
  }
}

function collectTalkerResponse({ username, message, timeoutMs, logger }) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let finished = false;
    let timeoutId = null;
    let toolInProgress = false;  // 追蹤是否有工具正在執行

    // ───────────────────────────────────────────
    // 區段：清理事件
    // 用途：避免事件監聯器洩漏
    // ───────────────────────────────────────────
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      talker.off('data', onData);
      talker.off('end', onEnd);
      talker.off('error', onError);
      talker.off('status', onStatus);
    };

    const onData = (chunk) => {
      if (finished) return;
      buffer += chunk || '';
    };

    // ───────────────────────────────────────────
    // 區段：狀態追蹤
    // 用途：偵測工具呼叫狀態，避免在工具執行中結束
    // 說明：當 waiting=true 且 reason='tool_busy' 時表示工具正在執行
    // ───────────────────────────────────────────
    const onStatus = (status) => {
      if (status?.waiting && status?.reason === 'tool_busy') {
        toolInProgress = true;
        logger.info(`[appVoiceMessageService] 偵測到工具呼叫中，等待工具完成...`);
      } else if (!status?.waiting && toolInProgress) {
        toolInProgress = false;
        logger.info(`[appVoiceMessageService] 工具呼叫完成，繼續等待 LLM 回覆...`);
      }
    };

    const onEnd = (endPayload) => {
      if (finished) return;
      
      // ───────────────────────────────────────────
      // 區段：工具呼叫處理
      // 用途：若 LLM 觸發了工具呼叫，不要結束，等待下一輪回覆
      // 說明：toolTriggered=true 表示 LLM 正在調用工具，
      //       會自動啟動第二輪，我們需要繼續等待最終回覆
      // ───────────────────────────────────────────
      const { toolTriggered } = endPayload || {};
      
      if (toolTriggered) {
        logger.info(`[appVoiceMessageService] LLM 調用工具中 (toolTriggered=true)，等待工具執行完成後的回覆...`);
        // 清空 buffer，因為工具呼叫前的內容通常是「請稍等」之類的訊息
        buffer = '';
        // 重置逾時計時器，給予工具執行的額外時間
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(handleTimeout, timeoutMs);
        }
        // 不結束，繼續監聽下一輪的 data 和 end
        return;
      }
      
      // 工具已完成或沒有工具呼叫，正常結束
      finished = true;
      cleanup();
      logger.info(`[appVoiceMessageService] LLM 回覆完成 (無待處理工具)，buffer長度=${buffer.length}`);
      resolve(buffer);
    };

    const onError = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err || new Error('LLM 串流錯誤'));
    };

    const handleTimeout = () => {
      if (finished) return;
      finished = true;

      // ───────────────────────────────────────
      // 區段：逾時中止
      // 用途：避免 LLM 回應無限等待
      // ───────────────────────────────────────
      if (talker.abort && typeof talker.abort === 'function') {
        try {
          talker.abort();
        } catch (error) {
          logger.error('LLM abort 失敗: ' + (error?.message || error));
        }
      }
      if (talker.stop && typeof talker.stop === 'function') {
        try {
          talker.stop();
        } catch (error) {
          logger.error('LLM stop 失敗: ' + (error?.message || error));
        }
      }

      cleanup();
      reject(new Error('LLM 回應逾時'));
    };

    // ───────────────────────────────────────────
    // 區段：綁定事件
    // 用途：確保 talker 回應能被完整收集
    // 說明：監聽 status 事件以追蹤工具呼叫狀態
    // ───────────────────────────────────────────
    talker.on('data', onData);
    talker.on('end', onEnd);
    talker.once('error', onError);
    talker.on('status', onStatus);

    timeoutId = setTimeout(handleTimeout, timeoutMs);

    try {
      talker.talk(username, message);
    } catch (error) {
      finished = true;
      cleanup();
      reject(error);
    }
  });
}

/**
 * 自訂錯誤類別用於語音處理管線
 * @param {string} code - 錯誤代碼
 * @param {string} message - 錯誤訊息
 * @param {string} details - 詳細錯誤資訊
 * @param {number} status - HTTP 狀態碼（預設 500）
 */
class PipelineError extends Error {
  constructor(code, message, details, status = 500) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

class VoiceMessagePipeline {
  constructor({ logger } = {}) {
    // ─────────────────────────────────────────
    // 區段：初始化
    // 用途：建立流程所需的共用依賴
    // ─────────────────────────────────────────
    this.logger = logger || fallbackLogger;
    this.pluginsManager = pluginsManager;
    this.voiceInboxDir = VOICE_INBOX_DIR;
    this.voiceOutboxDir = VOICE_OUTBOX_DIR;
    
    // ─────────────────────────────────────────
    // 區段：定期清理過期暫存檔
    // 用途：避免長期執行累積大量暫存檔案
    // ─────────────────────────────────────────
    this.startCleanupScheduler();
  }

  // ───────────────────────────────────────────
  // 區段：暫存檔定期清理
  // 用途：每 10 分鐘掃描一次，清除超過 1 小時的暫存檔
  // ───────────────────────────────────────────
  startCleanupScheduler() {
    const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 分鐘
    const FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 小時

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupOldFiles(this.voiceInboxDir, FILE_MAX_AGE_MS);
        await this.cleanupOldFiles(this.voiceOutboxDir, FILE_MAX_AGE_MS);
      } catch (error) {
        this.logger.error('[appVoiceMessageService] 定期清理失敗: ' + (error?.message || error));
      }
    }, CLEANUP_INTERVAL_MS);

    // 避免 interval 阻止程序正常結束
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  // ───────────────────────────────────────────
  // 區段：清理過期檔案
  // 用途：掃描目錄並刪除超過指定時間的檔案
  // ───────────────────────────────────────────
  async cleanupOldFiles(directory, maxAgeMs) {
    try {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        
        const fullPath = path.join(directory, entry.name);
        try {
          const stat = await fs.promises.stat(fullPath);
          const age = now - stat.mtimeMs;
          
          if (age > maxAgeMs) {
            await fs.promises.unlink(fullPath);
            this.logger.info(`[appVoiceMessageService] 清理過期檔案: ${entry.name}`);
          }
        } catch (error) {
          // 檔案可能已被其他流程刪除，忽略 ENOENT
          if (error?.code !== 'ENOENT') {
            this.logger.warn(`[appVoiceMessageService] 無法清理檔案 ${entry.name}: ${error?.message || error}`);
          }
        }
      }
    } catch (error) {
      // 目錄不存在或無法讀取，記錄但不拋出錯誤
      if (error?.code !== 'ENOENT') {
        this.logger.warn(`[appVoiceMessageService] 無法掃描目錄 ${directory}: ${error?.message || error}`);
      }
    }
  }

  // ───────────────────────────────────────────
  // 區段：前置處理
  // 用途：建立 trace_id / turn_id 並確保暫存目錄存在
  // 說明：記錄完整的 HTTP 請求資訊以利除錯
  // ───────────────────────────────────────────
  prepareRequestMiddleware() {
    return async (req, res, next) => {
      try {
        const traceId = generateUlid();
        const turnId = generateUlid();

        req.voiceContext = {
          traceId,
          turnId,
          receivedAt: Date.now()
        };

        // ─────────────────────────────────────────
        // 區段：HTTP 請求日誌
        // 用途：記錄完整的連線資訊以利除錯
        // ─────────────────────────────────────────
        const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        const protocol = req.protocol || (req.secure ? 'https' : 'http');
        const host = req.headers['host'] || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const contentType = req.headers['content-type'] || 'unknown';
        const contentLength = req.headers['content-length'] || '0';
        
        this.logger.info(`[appVoiceMessageService] ────────────────────────────────────────`);
        this.logger.info(`[appVoiceMessageService] 收到新請求 trace_id=${traceId}`);
        this.logger.info(`[appVoiceMessageService] 連線資訊: ${protocol}://${host}${req.originalUrl || req.url}`);
        this.logger.info(`[appVoiceMessageService] 客戶端 IP: ${clientIp}`);
        this.logger.info(`[appVoiceMessageService] User-Agent: ${userAgent}`);
        this.logger.info(`[appVoiceMessageService] Content-Type: ${contentType}`);
        this.logger.info(`[appVoiceMessageService] Content-Length: ${contentLength} bytes`);
        this.logger.info(`[appVoiceMessageService] 請求方法: ${req.method}`);
        
        // 記錄自訂 Headers（可能包含 App 版本等資訊）
        const customHeaders = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (key.startsWith('x-') && key !== 'x-forwarded-for') {
            customHeaders[key] = value;
          }
        }
        if (Object.keys(customHeaders).length > 0) {
          this.logger.info(`[appVoiceMessageService] 自訂 Headers: ${JSON.stringify(customHeaders)}`);
        }

        await this.ensureDirectories();
        next();
      } catch (error) {
        this.logger.error('[appVoiceMessageService] 前置處理失敗: ' + (error?.message || error));
        this.sendErrorResponse(res, {
          traceId: req.voiceContext?.traceId || '-',
          code: 'VOICE_INIT_FAILED',
          message: '初始化流程失敗',
          details: error?.message || String(error),
          status: 500
        });
      }
    };
  }

  // ───────────────────────────────────────────
  // 區段：上傳處理
  // 用途：透過 multer 接收單一音訊檔案
  // 說明：50MB 上傳限制已考慮語音檔案大小，應在基礎設施層級實施
  //       速率限制以防止 DoS 攻擊
  // ───────────────────────────────────────────
  uploadMiddleware() {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, this.voiceInboxDir);
      },
      filename: (req, file, cb) => {
        const traceId = req.voiceContext?.traceId || 'unknown';
        const extension = this.resolveExtension(file);
        cb(null, `${traceId}${extension}`);
      }
    });

    const upload = multer({
      storage,
      limits: {
        files: 1,
        fileSize: 50 * 1024 * 1024 // 50MB：適用於高品質語音檔案
      },
      fileFilter: (req, file, cb) => {
        if (!file || !file.mimetype) {
          return cb(new Error('VOICE_FILE_INVALID'));
        }
        if (!SUPPORTED_MIME_TYPES.has(file.mimetype)) {
          return cb(new Error('VOICE_FILE_UNSUPPORTED'));
        }
        return cb(null, true);
      }
    }).single('file');

    return (req, res, next) => {
      const uploadStartTime = Date.now();
      upload(req, res, (error) => {
        const uploadDuration = Date.now() - uploadStartTime;
        
        if (error) {
          const message = error.message === 'VOICE_FILE_UNSUPPORTED'
            ? '不支援的音訊格式'
            : '檔案上傳失敗';
          this.logger.error(`[appVoiceMessageService] 檔案上傳失敗 (耗時=${uploadDuration}ms): ` + (error.message || error));
          return this.sendErrorResponse(res, {
            traceId: req.voiceContext?.traceId,
            code: 'VOICE_UPLOAD_FAILED',
            message,
            details: error.message || String(error),
            status: 400
          });
        }
        
        // ─────────────────────────────────────────
        // 區段：上傳完成日誌
        // 用途：記錄上傳的檔案資訊
        // ─────────────────────────────────────────
        if (req.file) {
          this.logger.info(`[appVoiceMessageService] 檔案上傳完成 (耗時=${uploadDuration}ms)`);
          this.logger.info(`[appVoiceMessageService] 檔案名稱: ${req.file.originalname || 'unknown'}`);
          this.logger.info(`[appVoiceMessageService] 檔案大小: ${req.file.size} bytes`);
          this.logger.info(`[appVoiceMessageService] MIME 類型: ${req.file.mimetype}`);
          this.logger.info(`[appVoiceMessageService] 儲存路徑: ${req.file.path}`);
        }
        
        return next();
      });
    };
  }

  // ───────────────────────────────────────────
  // 區段：健康檢查
  // 用途：回傳服務狀態，不觸發實際流程
  // ───────────────────────────────────────────
  handleHealth(req, res) {
    return res.status(200).json({
      status: 'ok',
      service: 'appVoiceMessageService',
      timestamp: new Date().toISOString()
    });
  }

  // ───────────────────────────────────────────
  // 區段：主流程入口
  // 用途：執行完整語音處理管線並回傳音訊
  // ───────────────────────────────────────────
  async handleVoiceMessage(req, res) {
    const traceId = req.voiceContext?.traceId || generateUlid();
    const turnId = req.voiceContext?.turnId || generateUlid();
    const timers = {};
    const cleanupTargets = new Set();

    // ─────────────────────────────────────────
    // 區段：流程鎖定
    // 用途：避免同一 trace_id 重入執行
    // ─────────────────────────────────────────
    if (traceLocks.has(traceId)) {
      return this.sendErrorResponse(res, {
        traceId,
        code: 'VOICE_LOCKED',
        message: '該追蹤編號正在處理中',
        details: '重複請求已被拒絕',
        status: 409
      });
    }
    traceLocks.set(traceId, Date.now());

    try {
      // ───────────────────────────────────────
      // 區段：輸入檢查
      // 用途：確保有上傳音訊檔案
      // ───────────────────────────────────────
      if (!req.file) {
        throw new PipelineError('VOICE_FILE_MISSING', '未提供語音檔案', '檔案欄位 file 不存在', 400);
      }

      cleanupTargets.add(req.file.path);

      // ───────────────────────────────────────
      // 區段：ASR 轉寫
      // 用途：呼叫 ASR 插件取得文字內容
      // ───────────────────────────────────────
      this.logger.info(`[appVoiceMessageService] 開始 ASR 轉寫 trace_id=${traceId}`);
      timers.asrStart = Date.now();
      const asrResult = await this.callAsr({
        filePath: req.file.path,
        mime: req.file.mimetype,
        traceId
      });
      timers.asrDuration = Date.now() - timers.asrStart;
      this.logger.info(`[appVoiceMessageService] ASR 完成 耗時=${timers.asrDuration}ms`);

      const transcript = this.extractTranscript(asrResult);
      this.logger.info(`[appVoiceMessageService] ASR 轉寫結果: "${transcript?.substring(0, 100) || '(空)'}..."`);
      if (!transcript) {
        throw new PipelineError('ASR_FAILED', '語音轉文字失敗', asrResult?.error?.message || '無法取得轉寫結果');
      }

      // ───────────────────────────────────────
      // 區段：使用者名稱驗證
      // 用途：避免注入攻擊與確保紀錄安全
      // ───────────────────────────────────────
      let username = 'app';
      const rawUsername = req?.body?.username;
      if (rawUsername && typeof rawUsername === 'string') {
        const trimmedUsername = rawUsername.trim();
        const normalizedUsername = trimmedUsername.toLowerCase();
        const isValidUsername = USERNAME_PATTERN.test(normalizedUsername);

        if (isValidUsername) {
          username = normalizedUsername;
        } else {
          this.logger.warn('[appVoiceMessageService] 收到無效使用者名稱，使用預設值');
        }
      }

      // ───────────────────────────────────────
      // 區段：LLM 回覆
      // 用途：將轉寫文字送入 LLM 取得回應
      // ───────────────────────────────────────
      this.logger.info(`[appVoiceMessageService] 開始 LLM 回覆 username=${username}`);
      timers.llmStart = Date.now();
      const replyText = await enqueueTalkerRequest({
        username,
        message: transcript,
        timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
        logger: this.logger
      });
      timers.llmDuration = Date.now() - timers.llmStart;
      this.logger.info(`[appVoiceMessageService] LLM 完成 耗時=${timers.llmDuration}ms`);
      this.logger.info(`[appVoiceMessageService] LLM 回覆: "${replyText?.substring(0, 100) || '(空)'}..."`);

      if (!replyText || !replyText.trim()) {
        throw new PipelineError('LLM_FAILED', 'LLM 回覆失敗', 'LLM 未回傳有效文字');
      }

      // ───────────────────────────────────────
      // 區段：TTS 產生
      // 用途：呼叫 TTS 生成 wav 音檔
      // ───────────────────────────────────────
      timers.ttsStart = Date.now();
      const wavPath = await this.generateTtsArtifact({
        text: replyText,
        traceId,
        turnId
      });
      timers.ttsDuration = Date.now() - timers.ttsStart;
      cleanupTargets.add(wavPath);

      // ───────────────────────────────────────
      // 區段：音訊轉碼
      // 用途：將 wav 轉碼成 m4a 回傳給 App
      // ───────────────────────────────────────
      timers.transcodeStart = Date.now();
      const m4aPath = await this.transcodeToM4a({
        wavPath,
        traceId
      });
      timers.transcodeDuration = Date.now() - timers.transcodeStart;
      cleanupTargets.add(m4aPath);

      // ───────────────────────────────────────
      // 區段：耗時紀錄
      // 用途：輸出各階段耗時供效能分析
      // ───────────────────────────────────────
      this.logger.info(
        `[appVoiceMessageService] 耗時統計 trace_id=${traceId} ` +
          `ASR=${timers.asrDuration}ms ` +
          `LLM=${timers.llmDuration}ms ` +
          `TTS=${timers.ttsDuration}ms ` +
          `Transcode=${timers.transcodeDuration}ms`
      );

      // ───────────────────────────────────────
      // 區段：延後清理註冊
      // 用途：確保回應完成後清理暫存檔案
      // ───────────────────────────────────────
      res.on('finish', () => {
        this.cleanupFiles(cleanupTargets).catch((cleanupError) => {
          this.logger.error('[appVoiceMessageService] 清理暫存檔案失敗: ' + (cleanupError?.message || cleanupError));
        });
      });

      // ───────────────────────────────────────
      // 區段：回傳結果
      // 用途：串流 m4a 檔案並附上追蹤標頭
      // ───────────────────────────────────────
      return await this.streamAudioResponse(res, {
        traceId,
        turnId,
        m4aPath,
        timers
      });
    } catch (error) {
      const detail = error?.details || error?.message || String(error);
      const code = error?.code || 'VOICE_PIPELINE_FAILED';
      const message = error?.message || '語音處理失敗';
      const status = error?.status || 500;

      this.logger.error(`[appVoiceMessageService] 流程失敗: ${message} (${detail})`);
      
      // 先回應錯誤給前端，避免清理檔案阻塞回應
      const response = this.sendErrorResponse(res, {
        traceId,
        code,
        message,
        details: detail,
        status
      });

      // 非同步清理暫存檔案，不阻塞錯誤回應，並獨立處理清理錯誤
      this.cleanupFiles(cleanupTargets).catch((cleanupError) => {
        this.logger.warn(
          `[appVoiceMessageService] 清理暫存檔案失敗: ${cleanupError?.message || cleanupError}`
        );
      });

      return response;
    } finally {
      // ───────────────────────────────────────
      // 區段：釋放鎖
      // 用途：確保流程結束後解除鎖定
      // ───────────────────────────────────────
      traceLocks.delete(traceId);
    }

    return undefined;
  }

  // ───────────────────────────────────────────
  // 區段：ASR 呼叫
  // 用途：透過插件管理器呼叫 ASR 轉寫
  // ───────────────────────────────────────────
  async callAsr({ filePath, mime, traceId }) {
    const payload = {
      action: 'transcribeFile',
      payload: {
        file_path: filePath,
        mime,
        trace_id: traceId
      }
    };

    const result = await this.pluginsManager.send('ASR', payload);
    if (!result) {
      return { error: { code: 'ASR_UNAVAILABLE', message: 'ASR 插件無法使用' } };
    }
    return result;
  }

  // ───────────────────────────────────────────
  // 區段：TTS 產生
  // 用途：使用 TTS 插件取得 wav 檔案
  // 說明：直接傳送 text 給 ttsArtifact，包含強健的重試機制
  //       確保一定會等到 TTS 完成，不會因為引擎忙碌而失敗
  // ───────────────────────────────────────────
  async generateTtsArtifact({ text, traceId, turnId }) {
    this.logger.info(`[appVoiceMessageService] 開始 TTS 產生 trace_id=${traceId}`);
    this.logger.info(`[appVoiceMessageService] TTS 文字長度: ${text?.length || 0} 字元`);
    
    const targetDir = path.join(this.voiceOutboxDir, traceId);
    await fs.promises.mkdir(targetDir, { recursive: true });

    // 直接傳送 text，ttsArtifact 期望的格式是 { text: '...' } 或純字串
    const requestPayload = { text };

    // TTS 重試設定：使用指數退避策略確保一定會完成
    const { maxRetries, baseDelayMs, maxDelayMs, totalTimeoutMs, backoffMultiplier } = TTS_RETRY_CONFIG;
    
    let lastError = null;
    let currentDelay = baseDelayMs;
    const startTime = Date.now();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // 檢查是否已超過總超時時間
      const elapsed = Date.now() - startTime;
      if (elapsed >= totalTimeoutMs) {
        this.logger.error(`[appVoiceMessageService] TTS 總超時 (${elapsed}ms >= ${totalTimeoutMs}ms)`);
        throw new PipelineError('TTS_TIMEOUT', 'TTS 產生逾時', `已等待超過 ${totalTimeoutMs}ms`);
      }
      
      this.logger.info(`[appVoiceMessageService] 呼叫 ttsArtifact (嘗試 ${attempt}/${maxRetries}, 已耗時 ${elapsed}ms)...`);
      
      let result = null;
      try {
        result = await this.pluginsManager.send('ttsArtifact', requestPayload);
        this.logger.info(`[appVoiceMessageService] ttsArtifact 回傳: ${JSON.stringify(result)}`);
      } catch (error) {
        this.logger.error('[appVoiceMessageService] TTS 插件呼叫失敗: ' + (error?.message || error));
        lastError = error;
        
        // 使用指數退避等待後重試
        this.logger.info(`[appVoiceMessageService] 等待 ${currentDelay}ms 後重試...`);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
        continue;
      }

      // 檢查是否有錯誤回傳
      if (result?.error) {
        this.logger.error(`[appVoiceMessageService] ttsArtifact 回傳錯誤: ${result.error}`);
        lastError = new Error(result.error);
        
        // 如果是 "session 處理中" 或 "忙碌" 類型錯誤，繼續重試
        const isBusyError = result.error.includes('session') || 
                           result.error.includes('處理') || 
                           result.error.includes('busy') ||
                           result.error.includes('BUSY');
        
        if (isBusyError) {
          this.logger.info(`[appVoiceMessageService] TTS 引擎忙碌中，等待 ${currentDelay}ms 後重試...`);
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
          continue;
        }
        
        // 非忙碌類型的錯誤，直接拋出
        throw new PipelineError('TTS_FAILED', 'TTS 產生失敗', result.error);
      }

      const wavPath = this.extractTtsPath(result);
      this.logger.info(`[appVoiceMessageService] 解析 WAV 路徑: ${wavPath || '(空)'}`);
    
      if (wavPath) {
        // 確認檔案存在
        if (fs.existsSync(wavPath)) {
          const stats = fs.statSync(wavPath);
          this.logger.info(`[appVoiceMessageService] WAV 檔案確認存在, 大小: ${stats.size} bytes`);
          const totalElapsed = Date.now() - startTime;
          this.logger.info(`[appVoiceMessageService] TTS 成功完成，共嘗試 ${attempt} 次，總耗時 ${totalElapsed}ms`);
          return wavPath;
        } else {
          this.logger.error(`[appVoiceMessageService] WAV 路徑存在但檔案不存在: ${wavPath}`);
        }
      }
      
      // 沒有得到有效的 WAV 路徑，繼續重試
      this.logger.warn(`[appVoiceMessageService] 未取得有效 WAV 路徑，等待 ${currentDelay}ms 後重試...`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }

    // ─────────────────────────────────────────
    // 區段：相容性備援（已知限制）
    // 用途：若 TTS 未回傳有效路徑，嘗試從輸出資料夾偵測
    // ─────────────────────────────────────────
    this.logger.warn('[appVoiceMessageService] 主要 TTS 路徑解析失敗，嘗試備援機制...');
    if (!ttsFallbackWarningShown) {
      this.logger.warn('[appVoiceMessageService] TTS 插件未實作 ttsArtifact，使用不可靠的備援機制（此警告僅顯示一次）');
      ttsFallbackWarningShown = true;
    }
    try {
      await this.pluginsManager.send('ttsArtifact', text);
      const fallbackPath = await this.waitForWavFile(targetDir, DEFAULT_TTS_WAIT_TIMEOUT_MS);
      if (fallbackPath) {
        this.logger.info(`[appVoiceMessageService] 備援機制找到 WAV: ${fallbackPath}`);
        return fallbackPath;
      }
    } catch (error) {
      this.logger.error('[appVoiceMessageService] TTS 備援流程失敗: ' + (error?.message || error));
    }

    throw new PipelineError('TTS_FAILED', 'TTS 產生失敗', '無法取得 wav 檔案');
  }

  // ───────────────────────────────────────────
  // 區段：轉碼流程
  // 用途：使用 ffmpeg 將 wav 轉為 m4a
  // ───────────────────────────────────────────
  async transcodeToM4a({ wavPath, traceId }) {
    const outputPath = path.join(this.voiceOutboxDir, `${traceId}.m4a`);

    return new Promise((resolve, reject) => {
      const args = ['-y', '-i', wavPath, '-c:a', 'aac', '-b:a', '128k', outputPath];
      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let timeoutId = null;
      let completed = false;

      // ───────────────────────────────────────
      // 區段：逾時處理
      // 用途：避免 ffmpeg 無限等待
      // ───────────────────────────────────────
      timeoutId = setTimeout(() => {
        if (completed) return;
        completed = true;
        ffmpeg.kill('SIGKILL');
        reject(new PipelineError('TRANSCODE_FAILED', '音訊轉碼逾時', `超過 ${DEFAULT_FFMPEG_TIMEOUT_MS}ms`));
      }, DEFAULT_FFMPEG_TIMEOUT_MS);

      // ───────────────────────────────────────
      // 區段：錯誤監聽
      // 用途：收集 ffmpeg 錯誤輸出
      // ───────────────────────────────────────
      ffmpeg.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      ffmpeg.on('error', (error) => {
        if (completed) return;
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        reject(new PipelineError('TRANSCODE_FAILED', '音訊轉碼失敗', error.message || error));
      });

      ffmpeg.on('close', (code) => {
        if (completed) return;
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        
        if (code !== 0) {
          return reject(new PipelineError('TRANSCODE_FAILED', '音訊轉碼失敗', stderr || `ffmpeg exit code ${code}`));
        }
        return resolve(outputPath);
      });
    });
  }

  // ───────────────────────────────────────────
  // 區段：回應輸出
  // 用途：設定標頭並回傳 m4a 檔案
  // ───────────────────────────────────────────
  async streamAudioResponse(res, { traceId, turnId, m4aPath, timers }) {
    const stat = await fs.promises.stat(m4aPath);
    const totalProcessingTime = (timers.asrDuration || 0) + (timers.llmDuration || 0) + 
                                (timers.ttsDuration || 0) + (timers.transcodeDuration || 0);
    
    const headers = {
      'Content-Type': 'audio/m4a',
      'Content-Length': stat.size,
      'X-Trace-Id': traceId,
      'X-Turn-Id': turnId,
      'X-ASR-Duration-Ms': String(timers.asrDuration || 0),
      'X-LLM-Duration-Ms': String(timers.llmDuration || 0),
      'X-TTS-Duration-Ms': String(timers.ttsDuration || 0),
      'X-Transcode-Duration-Ms': String(timers.transcodeDuration || 0)
    };

    const exposeHeaders = Object.keys(headers).join(', ');
    res.set(headers);
    res.set('Access-Control-Expose-Headers', exposeHeaders);
    res.status(200);

    // ─────────────────────────────────────────
    // 區段：回應日誌
    // 用途：記錄回應資訊以利除錯
    // ─────────────────────────────────────────
    this.logger.info(`[appVoiceMessageService] 開始回傳音訊 trace_id=${traceId}`);
    this.logger.info(`[appVoiceMessageService] 回應大小: ${stat.size} bytes`);
    this.logger.info(`[appVoiceMessageService] 回應 Headers: ${JSON.stringify(headers)}`);

    const streamStartTime = Date.now();

    return new Promise((resolve, reject) => {
      // 使用較大的 highWaterMark 以改善大型音訊檔串流效能
      // 預設為 64KB，這裡改為 256KB 以在記憶體與吞吐量間取得平衡
      const stream = fs.createReadStream(m4aPath, {
        highWaterMark: 256 * 1024
      });

      // ───────────────────────────────────────
      // 區段：串流錯誤處理
      // 用途：避免回傳過程中斷造成無回應
      // ───────────────────────────────────────
      stream.on('error', (error) => {
        this.logger.error('[appVoiceMessageService] 音訊串流失敗: ' + (error?.message || error));
        
        // 明確終止串流以釋放資源
        stream.destroy();
        
        if (!res.headersSent) {
          this.sendErrorResponse(res, {
            traceId,
            code: 'VOICE_STREAM_FAILED',
            message: '音訊回傳失敗',
            details: error?.message || String(error),
            status: 500
          });
        } else {
          // 標頭已發送，無法回傳錯誤，但至少關閉回應
          res.end();
        }
        reject(error);
      });

      stream.on('end', () => {
        const streamDuration = Date.now() - streamStartTime;
        this.logger.info(`[appVoiceMessageService] 音訊串流完成 trace_id=${traceId} 串流耗時=${streamDuration}ms`);
        this.logger.info(`[appVoiceMessageService] 請求處理完成 trace_id=${traceId} 總處理時間=${totalProcessingTime}ms`);
        this.logger.info(`[appVoiceMessageService] ────────────────────────────────────────`);
        resolve();
      });
      
      stream.pipe(res);
    });
  }

  // ───────────────────────────────────────────
  // 區段：錯誤回應
  // 用途：統一 JSON 錯誤格式
  // 說明：使用 snake_case（trace_id）而非 camelCase 以符合 API 規格
  //       與 HTTP 標頭 X-Trace-Id 保持一致性
  // ───────────────────────────────────────────
  sendErrorResponse(res, { traceId, code, message, details, status }) {
    if (res.headersSent) {
      this.logger.warn(`[appVoiceMessageService] 無法發送錯誤回應 (headers已發送) trace_id=${traceId}`);
      return;
    }
    
    this.logger.info(`[appVoiceMessageService] 發送錯誤回應 trace_id=${traceId} status=${status || 500}`);
    this.logger.info(`[appVoiceMessageService] 錯誤內容: code=${code}, message=${message}`);
    this.logger.info(`[appVoiceMessageService] ────────────────────────────────────────`);
    
    res.status(status || 500).json({
      trace_id: traceId,
      error: {
        code,
        message,
        details
      }
    });
  }

  // ───────────────────────────────────────────
  // 區段：暫存檔清理
  // 用途：確保成功或失敗後釋放檔案
  // ───────────────────────────────────────────
  async cleanupFiles(targets) {
    const files = Array.from(targets || []);
    for (const filePath of files) {
      if (!filePath) continue;
      try {
        await fs.promises.unlink(filePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          this.logger.error('[appVoiceMessageService] 清理檔案失敗: ' + (error?.message || error));
        }
      }
    }
  }

  // ───────────────────────────────────────────
  // 區段：目錄建立
  // 用途：確保暫存目錄存在
  // ───────────────────────────────────────────
  async ensureDirectories() {
    await fs.promises.mkdir(this.voiceInboxDir, { recursive: true });
    await fs.promises.mkdir(this.voiceOutboxDir, { recursive: true });
  }

  // ───────────────────────────────────────────
  // 區段：格式解析
  // 用途：從 multer 結果取得檔案副檔名
  // ───────────────────────────────────────────
  resolveExtension(file) {
    const originalExt = path.extname(file?.originalname || '').toLowerCase();
    if (originalExt && FILE_EXTENSION_PATTERN.test(originalExt)) {
      return originalExt;
    }
    return SUPPORTED_MIME_TYPES.get(file?.mimetype) || '.wav';
  }

  // ───────────────────────────────────────────
  // 區段：轉寫結果解析
  // 用途：從 ASR 回傳格式提取文字
  // ───────────────────────────────────────────
  extractTranscript(asrResult) {
    if (!asrResult || typeof asrResult !== 'object') return '';
    if (asrResult.error) return '';
    if (typeof asrResult.text === 'string') return asrResult.text;
    if (typeof asrResult.transcript === 'string') return asrResult.transcript;
    if (typeof asrResult.result === 'string') return asrResult.result;
    if (typeof asrResult.resultText === 'string') return asrResult.resultText;
    if (asrResult.result && typeof asrResult.result.text === 'string') return asrResult.result.text;
    return '';
  }

  // ───────────────────────────────────────────
  // 區段：TTS 回傳解析
  // 用途：從 TTS 插件回傳中取得檔案路徑
  // 說明：ttsArtifact 回傳格式為 { artifact_id, url, format, duration_ms }
  //       需要透過 artifact_id 查找實際檔案路徑
  // ───────────────────────────────────────────
  extractTtsPath(result) {
    if (!result || typeof result !== 'object') return '';
    
    // 檢查是否有錯誤
    if (result.error) {
      this.logger.error(`[appVoiceMessageService] TTS 回傳錯誤: ${result.error}`);
      return '';
    }
    
    // 優先使用直接提供的檔案路徑
    const directPath = result.wav_path || result.file_path || result.artifact_path || result.path || '';
    if (directPath) return directPath;
    
    // 若有 artifact_id，嘗試從標準路徑取得檔案
    if (result.artifact_id) {
      const path = require('path');
      const fs = require('fs');
      const artifactId = result.artifact_id;
      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      
      // ttsArtifact 標準路徑格式: data/artifacts/tts/{year}/{month}/{day}/{artifact_id}/audio.wav
      const standardPath = path.resolve(
        process.cwd(),
        'data', 'artifacts', 'tts', year, month, day, artifactId, 'audio.wav'
      );
      
      if (fs.existsSync(standardPath)) {
        this.logger.info(`[appVoiceMessageService] 透過 artifact_id 找到 WAV: ${standardPath}`);
        return standardPath;
      }
      
      this.logger.warn(`[appVoiceMessageService] artifact_id=${artifactId} 但找不到檔案: ${standardPath}`);
    }
    
    return '';
  }

  // ───────────────────────────────────────────
  // 區段：等待檔案
  // 用途：輪詢輸出資料夾取得最新 wav
  // ───────────────────────────────────────────
  async waitForWavFile(directory, timeoutMs) {
    const startTime = Date.now();
    const endTime = startTime + timeoutMs;

    while (Date.now() < endTime) {
      try {
        const entries = await fs.promises.readdir(directory);
        const wavFiles = [];

        for (const entry of entries) {
          if (!entry.toLowerCase().endsWith('.wav')) continue;
          const fullPath = path.join(directory, entry);
          const stat = await fs.promises.stat(fullPath);
          if (stat.mtimeMs >= startTime) {
            wavFiles.push({ path: fullPath, mtimeMs: stat.mtimeMs });
          }
        }

        if (wavFiles.length > 0) {
          wavFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
          return wavFiles[0].path;
        }
      } catch (error) {
        this.logger.error('[appVoiceMessageService] 讀取 TTS 輸出失敗: ' + (error?.message || error));
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return '';
  }
}

module.exports = VoiceMessagePipeline;
