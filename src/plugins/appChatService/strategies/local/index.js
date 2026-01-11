// ───────────────────────────────────────────────
// appChatService plugin (Cloudflare A record / reverse proxy friendly)
// 外網入口： https://xiaoDemon.dev/ios-app/chat
// 內部監聽： http://0.0.0.0:8080/ios-app/chat  (建議 8080，Cloudflare 允許)
// ───────────────────────────────────────────────

const express = require('express');

const talker = require('../../../../core/TalkToDemon.js');
const Logger = require('../../../../utils/logger');

const logger = new Logger('appChatService');

const ROUTE_PREFIX = '/ios-app';
const ROUTE_PATH = '/chat';
const FULL_ROUTE_PATH = `${ROUTE_PREFIX}${ROUTE_PATH}`;

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_USERNAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 10000;

const priority = 70;

// Cloudflare 反代可連到的 HTTP 允許 port：80/8080/8880/...
// 沒有 Nginx 的情況下，直接用 8080 最省事
const DEFAULT_LISTEN_HOST = '0.0.0.0';
const DEFAULT_LISTEN_PORT = 80;

let registered = false;
let app = null;
let server = null;

// ───────────────────────────────────────────────
// 請求佇列：避免 talker 事件混淆（因為 talker 是事件匯流排風格）
// ───────────────────────────────────────────────
let requestQueue = [];
let isProcessing = false;

const ERROR_MESSAGES = {
  400: '請求格式無效，請確認 username 和 message 欄位。',
  404: '找不到該路徑。',
  405: '不支援的 HTTP 方法。',
  415: '不支援的 Content-Type，請使用 application/json。',
  500: '系統暫時無法處理，請稍後再試。'
};

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function validateInput(username, message) {
  if (!username || !message) {
    return { valid: false, error: '欄位 username 和 message 不可為空。' };
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return { valid: false, error: `username 長度不可超過 ${MAX_USERNAME_LENGTH} 字元。` };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `message 長度不可超過 ${MAX_MESSAGE_LENGTH} 字元。` };
  }
  return { valid: true };
}

function sendErrorResponse(res, statusCode, overrideMessage) {
  const text = overrideMessage || ERROR_MESSAGES[statusCode] || ERROR_MESSAGES[500];
  return res.status(statusCode).json({
    status: 'error',
    message: { text }
  });
}

async function processNextRequest() {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;
  const { username, message, timeoutMs, resolve, reject } = requestQueue.shift();

  try {
    const result = await collectTalkerResponseInternal(username, message, timeoutMs);
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    isProcessing = false;
    setImmediate(() => processNextRequest());
  }
}

function enqueueRequest(username, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ username, message, timeoutMs, resolve, reject });
    processNextRequest();
  });
}

function collectTalkerResponseInternal(username, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let finished = false;
    let timeoutId = null;

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

    // 先綁事件，避免遺漏
    // 注意：不監聽 abort 事件，因為工具調用時的 stop() 會觸發 abort
    // 但這是正常流程的一部分，最終會收到 end 事件
    talker.on('data', onData);
    talker.on('end', onEnd);
    talker.on('error', onError);

    timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;

      // 盡可能中止底層對話
      if (typeof talker.abort === 'function') {
        try { talker.abort(); } catch (e) { logger.error('abort failed', e); }
      }
      if (typeof talker.stop === 'function') {
        try { talker.stop(); } catch (e) { logger.error('stop failed', e); }
      }

      cleanup();
      reject(new Error('LLM 回應逾時'));
    }, timeoutMs);

    try {
      talker.talk(username, message);
    } catch (err) {
      finished = true;
      cleanup();
      reject(err);
    }
  });
}

function collectTalkerResponse(username, message, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  return enqueueRequest(username, message, timeoutMs);
}

function buildExpressApp() {
  const _app = express();

  // 僅接受 JSON
  _app.use(express.json({ limit: '256kb' }));

  // 健康檢查（可選）
  _app.get('/healthz', (req, res) => res.status(200).send('ok'));

  // 嚴格路由：POST /ios-app/chat
  _app.post(FULL_ROUTE_PATH, async (req, res) => {
    // Content-Type 檢查（express.json 已經會擋很多，但這裡做明確回應）
    if (!req.is('application/json')) {
      logger.warn('[appChatService] Content-Type 非 JSON');
      return sendErrorResponse(res, 415);
    }

    const username = normalizeString(req.body?.username);
    const message = normalizeString(req.body?.message);

    const validation = validateInput(username, message);
    if (!validation.valid) {
      logger.warn(`[appChatService] 輸入驗證失敗: ${validation.error}`);
      return sendErrorResponse(res, 400, validation.error);
    }

    try {
      const responseText = await collectTalkerResponse(username, message, {
        timeoutMs: DEFAULT_TIMEOUT_MS
      });
      return res.status(200).json({
        status: 'ok',
        message: { text: responseText }
      });
    } catch (err) {
      logger.error(`[appChatService] LLM 回應失敗: ${err?.message || err}`);
      return sendErrorResponse(res, 500);
    }
  });

  // 對其他方法給 405（比 404 更精準）
  _app.all(FULL_ROUTE_PATH, (req, res) => sendErrorResponse(res, 405));

  return _app;
}

module.exports = {
  priority,

  /**
   * 啟動插件：直接開一個 HTTP server
   * options:
   *  - host: 預設 0.0.0.0
   *  - port: 預設 8080（Cloudflare 可連）
   */
  async online(options = {}) {
    if (registered) {
      logger.warn('[appChatService] 已啟動，跳過重複 online');
      return true;
    }

    const host = options.host || DEFAULT_LISTEN_HOST;
    const port = Number(options.port || process.env.APP_CHAT_SERVICE_PORT || DEFAULT_LISTEN_PORT);

    try {
      app = buildExpressApp();
      server = app.listen(port, host, () => {
        logger.info(`[appChatService] Listening on http://${host}:${port}${FULL_ROUTE_PATH}`);
      });

      registered = true;
      return true;
    } catch (err) {
      logger.error(`[appChatService] 啟動失敗: ${err?.message || err}`);
      registered = false;
      app = null;
      server = null;
      return false;
    }
  },

  /**
   * 關閉插件：關閉 HTTP server
   */
  async offline() {
    if (!registered) return true;

    try {
      await new Promise((resolve, reject) => {
        if (!server) return resolve();
        server.close((err) => (err ? reject(err) : resolve()));
      });

      registered = false;
      app = null;
      server = null;
      return true;
    } catch (err) {
      logger.error(`[appChatService] 關閉失敗: ${err?.message || err}`);
      return false;
    }
  },

  async restart(options = {}) {
    await this.offline();
    return this.online(options);
  },

  async state() {
    return registered ? 1 : 0;
  }
};
