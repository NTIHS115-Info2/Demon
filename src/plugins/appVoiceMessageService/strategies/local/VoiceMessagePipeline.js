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

// ───────────────────────────────────────────────
// 區段：支援的音訊格式
// 用途：限制上傳格式，避免不支援的音訊造成流程錯誤
// 注意：'audio/mp4' 通常用於 MP4 容器格式（可能包含視訊），
//       但在此映射為 .m4a（純音訊）。'audio/m4a' 與 'audio/x-m4a'
//       是 M4A 音訊的常見 MIME 類型。請根據預期的客戶端行為驗證。
// ───────────────────────────────────────────────
const SUPPORTED_MIME_TYPES = new Map([
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
  ['audio/m4a', '.m4a'],
  ['audio/mp4', '.m4a'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp3', '.mp3'],
  ['audio/ogg', '.ogg'],
  ['audio/webm', '.webm'],
  ['audio/flac', '.flac']
]);

// ───────────────────────────────────────────────
// 區段：處理鎖
// 用途：避免相同 trace_id 併發重入
// 說明：雖然 ULID 應該是唯一的，但長時間執行可能累積記憶體。
//       實際上，鎖會在 finally 區塊中釋放，因此成功或失敗的請求
//       都會清理。此 Map 不應無限增長，除非發生程序中止等異常。
//       鎖定清理由 VoiceMessagePipeline 實例管理。
// ───────────────────────────────────────────────
const traceLocks = new Map();

// ───────────────────────────────────────────────
// 區段：LLM 請求序列化
// 用途：避免 talker 事件流混淆
// 說明：以下狀態為模組層級共享，所有 VoiceMessagePipeline 實例會共用
//       同一個 LLM 請求佇列，以「全域序列化」方式避免 talker 事件流互相干擾。
//       若改為每個實例各自持有佇列，將失去這個全域排序保證。
// ───────────────────────────────────────────────
let requestQueue = [];
let isProcessing = false;

function enqueueTalkerRequest(payload) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ ...payload, resolve, reject });
    // 僅在佇列先前閒置時啟動處理
    if (!isProcessing) {
      processNextTalkerRequest();
    }
  });
}

async function processNextTalkerRequest() {
  if (isProcessing) return;
  isProcessing = true;

  try {
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
    // 如果在迴圈結束後、釋放旗標前有新任務加入，確保它們被處理
    if (requestQueue.length > 0) {
      processNextTalkerRequest();
    }
  }
}

function collectTalkerResponse({ username, message, timeoutMs, logger }) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let finished = false;
    let timeoutId = null;

    // ───────────────────────────────────────────
    // 區段：清理事件
    // 用途：避免事件監聽器洩漏
    // ───────────────────────────────────────────
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      talker.off('data', onData);
      talker.off('end', onEnd);
      talker.off('error', onError);
    };

    const onData = (chunk) => {
      if (finished) return;
      buffer += chunk || '';
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(buffer);
    };

    const onError = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err || new Error('LLM 串流錯誤'));
    };

    // ───────────────────────────────────────────
    // 區段：綁定事件
    // 用途：確保 talker 回應能被完整收集
    // 說明：使用 .once() 以避免全域 talker 實例上的監聽器累積
    // ───────────────────────────────────────────
    talker.on('data', onData);
    talker.once('end', onEnd);
    talker.once('error', onError);

    timeoutId = setTimeout(() => {
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
    }, timeoutMs);

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
 * 自訂錯誤類別，用於攜帶額外的錯誤資訊
 * @param {string} code - 錯誤代碼
 * @param {string} message - 錯誤訊息
 * @param {*} details - 詳細錯誤資訊
 * @param {number} [status=500] - HTTP 狀態碼
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
  // 靜態屬性：追蹤鎖定清理是否已初始化
  static _lockCleanupInitialized = false;

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
    // 區段：啟動定期清理
    // 用途：每小時清理超過 2 小時的孤立檔案
    // ─────────────────────────────────────────
    this.orphanedFileCleanupInterval = setInterval(() => {
      this.cleanupOrphanedFiles(2 * 60 * 60 * 1000).catch((err) => {
        this.logger.error('[appVoiceMessageService] 孤立檔案清理失敗: ' + (err?.message || err));
      });
    }, 60 * 60 * 1000).unref(); // 每小時執行一次，unref() 避免阻止程序退出

    // ─────────────────────────────────────────
    // 區段：啟動鎖定清理（僅執行一次）
    // 用途：定期清理過期的 traceLocks
    // ─────────────────────────────────────────
    VoiceMessagePipeline.ensureLockCleanup();
  }

  /**
   * 清理並停止所有定期任務
   */
  destroy() {
    if (this.orphanedFileCleanupInterval) {
      clearInterval(this.orphanedFileCleanupInterval);
      this.orphanedFileCleanupInterval = null;
    }
  }

  /**
   * 確保鎖定清理計時器啟動（僅執行一次）
   */
  static ensureLockCleanup() {
    if (VoiceMessagePipeline._lockCleanupInitialized) return;
    VoiceMessagePipeline._lockCleanupInitialized = true;

    const LOCK_EXPIRY_MS = 10 * 60 * 1000; // 10 分鐘
    setInterval(() => {
      const now = Date.now();
      for (const [traceId, timestamp] of traceLocks.entries()) {
        if (now - timestamp > LOCK_EXPIRY_MS) {
          traceLocks.delete(traceId);
        }
      }
    }, 5 * 60 * 1000).unref(); // 每 5 分鐘執行一次，unref() 避免阻止程序退出
  }

  // ───────────────────────────────────────────
  // 區段：前置處理
  // 用途：建立 trace_id / turn_id 並確保暫存目錄存在
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
        // 50MB 檔案大小限制
        // 注意：公開端點可能面臨 DoS 攻擊風險，建議在基礎設施層實作速率限制
        fileSize: 50 * 1024 * 1024
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
      upload(req, res, (error) => {
        if (error) {
          const message = error.message === 'VOICE_FILE_UNSUPPORTED'
            ? '不支援的音訊格式'
            : '檔案上傳失敗';
          this.logger.error('[appVoiceMessageService] 檔案上傳失敗: ' + (error.message || error));
          return this.sendErrorResponse(res, {
            traceId: req.voiceContext?.traceId,
            code: 'VOICE_UPLOAD_FAILED',
            message,
            details: error.message || String(error),
            status: 400
          });
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
      timers.asrStart = Date.now();
      const asrResult = await this.callAsr({
        filePath: req.file.path,
        mime: req.file.mimetype,
        traceId
      });
      timers.asrDuration = Date.now() - timers.asrStart;

      const transcript = this.extractTranscript(asrResult);
      if (!transcript) {
        throw new PipelineError('ASR_FAILED', '語音轉文字失敗', asrResult?.error?.message || '無法取得轉寫結果');
      }

      // ───────────────────────────────────────
      // 區段：LLM 回覆
      // 用途：將轉寫文字送入 LLM 取得回應
      // ───────────────────────────────────────
      
      // 驗證並清理 username，防止注入攻擊或記錄敏感資料
      let username = 'app';
      const rawUsername =
        req &&
        req.body &&
        typeof req.body.username === 'string'
          ? req.body.username
          : '';

      if (rawUsername) {
        const trimmedUsername = rawUsername.trim();
        const normalizedUsername = trimmedUsername.toLowerCase();
        // 僅允許字母、數字與底線，防止路徑遍歷攻擊，並限制長度上限
        const isValidUsername = /^[a-z0-9_]{1,64}$/.test(normalizedUsername);

        if (isValidUsername) {
          username = normalizedUsername;
        } else if (this.logger && typeof this.logger.warn === 'function') {
          // 避免記錄原始的、可能惡意的 username 內容
          this.logger.warn('收到無效的 username；使用預設值。');
        }
      }

      timers.llmStart = Date.now();
      const replyText = await enqueueTalkerRequest({
        username,
        message: transcript,
        timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
        logger: this.logger
      });
      timers.llmDuration = Date.now() - timers.llmStart;

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
      await this.streamAudioResponse(res, {
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
  // ───────────────────────────────────────────
  async generateTtsArtifact({ text, traceId, turnId }) {
    const targetDir = path.join(this.voiceOutboxDir, traceId);
    await fs.promises.mkdir(targetDir, { recursive: true });

    const requestPayload = {
      action: 'ttsArtifact',
      payload: {
        text,
        trace_id: traceId,
        turn_id: turnId,
        output_dir: targetDir
      }
    };

    let result = null;
    try {
      result = await this.pluginsManager.send('tts', requestPayload);
    } catch (error) {
      this.logger.error('[appVoiceMessageService] TTS 插件呼叫失敗: ' + (error?.message || error));
    }

    const wavPath = this.extractTtsPath(result);
    if (wavPath) {
      return wavPath;
    }

    // ─────────────────────────────────────────
    // 區段：相容性備援
    // 用途：若 TTS 未提供檔案，嘗試從輸出資料夾偵測
    // 警告：此備援機制存在已知問題：
    //   1) 未傳遞 trace_id 或 turn_id，難以關聯輸出
    //   2) 指數退避輪詢仍可能造成效能問題
    //   3) 併發 TTS 請求可能取得錯誤的檔案（競爭條件）
    // 建議：TTS 插件應實作 `ttsArtifact` 動作以避免使用此備援
    // ─────────────────────────────────────────
    try {
      await this.pluginsManager.send('tts', text);
      const fallbackPath = await this.waitForWavFile(targetDir, DEFAULT_TTS_WAIT_TIMEOUT_MS);
      if (fallbackPath) {
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
    const FFMPEG_TIMEOUT_MS = 60000; // 60 秒逾時限制

    return new Promise((resolve, reject) => {
      const args = ['-y', '-i', wavPath, '-c:a', 'aac', '-b:a', '128k', outputPath];
      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let completed = false;

      // ───────────────────────────────────────
      // 區段：逾時機制
      // 用途：避免 ffmpeg 程序無限期執行
      // ───────────────────────────────────────
      const timeoutId = setTimeout(() => {
        if (completed) return;
        completed = true;
        ffmpeg.kill('SIGTERM');
        reject(new PipelineError('TRANSCODE_TIMEOUT', '音訊轉碼逾時', `ffmpeg 超過 ${FFMPEG_TIMEOUT_MS}ms 未完成`));
      }, FFMPEG_TIMEOUT_MS);

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
        clearTimeout(timeoutId);
        reject(new PipelineError('TRANSCODE_FAILED', '音訊轉碼失敗', error.message || error));
      });

      ffmpeg.on('close', (code) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        
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
        stream.destroy();
        if (!res.headersSent) {
          this.sendErrorResponse(res, {
            traceId,
            code: 'VOICE_STREAM_FAILED',
            message: '音訊回傳失敗',
            details: error?.message || String(error),
            status: 500
          });
        }
        reject(error);
      });

      stream.on('end', resolve);
      stream.pipe(res);
    });
  }

  // ───────────────────────────────────────────
  // 區段：錯誤回應
  // 用途：統一 JSON 錯誤格式
  // 注意：使用 snake_case 'trace_id' 以保持與 API 回應標頭
  //       (`X-Trace-Id`) 的一致性，符合外部 API 契約。
  // ───────────────────────────────────────────
  sendErrorResponse(res, { traceId, code, message, details, status }) {
    if (res.headersSent) return;
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
  // 區段：孤立檔案清理
  // 用途：清理超過指定時間的暫存檔案（防止客戶端中斷等異常情況累積）
  // ───────────────────────────────────────────
  async cleanupOrphanedFiles(maxAgeMs = 60 * 60 * 1000) {
    const now = Date.now();
    const directories = [this.voiceInboxDir, this.voiceOutboxDir];

    for (const dir of directories) {
      try {
        const entries = await fs.promises.readdir(dir);
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.isFile() && (now - stat.mtimeMs > maxAgeMs)) {
              await fs.promises.unlink(fullPath);
              this.logger.info(`[appVoiceMessageService] 清理孤立檔案: ${entry}`);
            }
          } catch (error) {
            // 忽略無法讀取或已被刪除的檔案
          }
        }
      } catch (error) {
        // 忽略目錄不存在等錯誤
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
    // 使用白名單方式驗證副檔名，與 SUPPORTED_MIME_TYPES 對應
    if (originalExt && /^\.(wav|mp3|m4a|ogg|webm|flac)$/i.test(originalExt)) {
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
  // ───────────────────────────────────────────
  extractTtsPath(result) {
    if (!result || typeof result !== 'object') return '';
    return (
      result.wav_path ||
      result.file_path ||
      result.artifact_path ||
      result.path ||
      ''
    );
  }

  // ───────────────────────────────────────────
  // 區段：等待檔案
  // 用途：使用指數退避輪詢輸出資料夾取得最新 wav
  // 注意：由於每個 traceId 使用獨立目錄，併發 TTS 的競爭條件已被緩解。
  //       時間戳記檢查使用小緩衝區以處理檔案系統時間精度問題。
  // ───────────────────────────────────────────
  async waitForWavFile(directory, timeoutMs) {
    // 減去 100ms 緩衝以處理檔案系統時間精度
    const startTime = Date.now() - 100;
    const endTime = startTime + timeoutMs;
    let delay = 100; // 初始延遲 100ms
    const maxDelay = 2000; // 最大延遲 2 秒

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

      // 使用指數退避以減少檔案系統操作次數
      // 採用 1.5 倍增長係數（而非典型的 2 倍），以在減少 I/O 與快速偵測間取得平衡
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, maxDelay);
    }

    return '';
  }
}

module.exports = VoiceMessagePipeline;
