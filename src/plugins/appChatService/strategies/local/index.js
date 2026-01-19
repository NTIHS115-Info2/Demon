// ───────────────────────────────────────────────
// appChatService plugin (Cloudflare A record / reverse proxy friendly)
// 外網入口： https://xiaoDemon.dev/ios-app/chat
// 內部監聽：由主服務 Express app 統一管理
// ───────────────────────────────────────────────

const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const talker = require('../../../../core/TalkToDemon.js');
const Logger = require('../../../../utils/logger');

const logger = new Logger('appChatService');

const ROUTE_PREFIX = '/ios-app';
const ROUTE_PATH = '/chat';
const FULL_ROUTE_PATH = `${ROUTE_PREFIX}${ROUTE_PATH}`;
const WS_ROUTE_PATH = `${FULL_ROUTE_PATH}/ws`;

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_USERNAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 10000;

const priority = 70;

// 注入狀態：紀錄是否已完成路由註冊與線上狀態
let registered = false;
let isOnline = false;
let expressApp = null;
let httpServer = null;

// WS：僅註冊一次 upgrade handler
let wsRegistered = false;
let wss = null;
let wsActiveRequest = false; // MVP：同一時間只跑一個 request（避免 talker 事件混線）

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
  409: '目前有進行中的 WebSocket 對話，請稍後再試。',
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
  if (wsActiveRequest) {
    setImmediate(() => processNextRequest());
    return;
  }

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

function buildRouter() {
  // 建立 Router，避免直接操作主 Express app
  const router = express.Router();

  // 僅接受 JSON，限制 payload 大小避免濫用
  router.use(express.json({ limit: '256kb' }));

  // 健康檢查（可選）
  router.get('/healthz', (req, res) => res.status(200).send('ok'));

  // 嚴格路由：POST /ios-app/chat
  router.post(FULL_ROUTE_PATH, async (req, res) => {
    // Content-Type 檢查（express.json 已經會擋很多，但這裡做明確回應）
    if (!req.is('application/json')) {
      logger.warn('[appChatService] Content-Type 非 JSON');
      return sendErrorResponse(res, 415);
    }
    if (wsActiveRequest) {
      logger.warn('[appChatService] WS 進行中，拒絕 HTTP 請求');
      return sendErrorResponse(res, 409);
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
  router.all(FULL_ROUTE_PATH, (req, res) => sendErrorResponse(res, 405));

  return router;
}

// ───────────────────────────────────────────────
// WebSocket：/ios-app/chat/ws
// 需求：
//  1) 將 LLM 的 reasoning 視為「思考」並串流給前端
//  2) 前端可收到推理/工具狀態（thinking / using_tool）
//  3) 工具偽協議 JSON 內容不應出現在前端串流（已由 TalkToDemon + ToolStreamRouter 於伺服端切除）
// 注意：talker 是單例 EventEmitter，為避免事件混線，MVP 先限制同時一個 WS request。
// ───────────────────────────────────────────────
function registerWebSocket(server) {
  if (wsRegistered) return;
  wsRegistered = true;

  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = req.url || '';
      // 只處理指定路徑，其他交回預設處理
      if (!url.startsWith(WS_ROUTE_PATH)) return;

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch (err) {
      try { socket.destroy(); } catch {}
    }
  });

  wss.on('connection', (ws) => {
    const send = (obj) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(obj));
    };

    let bound = false;
    let requestId = null;
    let phaseId = null;
    let round = null;

    const cleanup = () => {
      if (!bound) return;
      bound = false;
      talker.off('stream', onStream);
      talker.off('status', onStatus);
      talker.off('round_end', onRoundEnd);
      talker.off('end', onEnd);
      talker.off('error', onError);
      wsActiveRequest = false;
    };

    const onStream = (pkt) => {
      // pkt: { channel:'talk'|'think', content, phaseId }
      phaseId = pkt?.phaseId ?? phaseId;
      send({
        type: 'delta',
        requestId,
        phaseId,
        channel: pkt?.channel || 'talk',
        content: pkt?.content || ''
      });
    };

    const onStatus = (st) => {
      phaseId = st?.phaseId ?? phaseId;
      send({
        type: 'status',
        requestId,
        phaseId,
        state: st?.state || (st?.waiting ? 'using_tool' : 'thinking'),
        usingTool: !!st?.usingTool || !!st?.waiting,
        tool: st?.tool || null
      });
    };

    const onRoundEnd = (info = {}) => {
      phaseId = info?.phaseId ?? phaseId;
      round = info?.round ?? round;
      send({
        type: 'round_end',
        requestId,
        phaseId,
        round,
        toolTriggered: info?.toolTriggered !== false
      });
    };

    const onEnd = (info = {}) => {
      phaseId = info?.phaseId ?? phaseId;
      round = info?.round ?? round;
      send({
        type: 'end',
        requestId,
        phaseId,
        round,
        toolTriggered: !!info.toolTriggered,
        final: info?.final === true
      });
      cleanup();
    };

    const onError = (err) => {
      send({ type: 'error', requestId, message: err?.message || String(err || 'unknown error') });
      cleanup();
    };

    ws.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(String(raw || ''));
      } catch {
        send({ type: 'error', requestId: null, message: 'Invalid JSON payload' });
        return;
      }

      // 只接受一次「start」訊息
      if (bound) {
        send({ type: 'error', requestId, message: 'Request already started on this connection' });
        return;
      }

      if (wsActiveRequest || isProcessing || requestQueue.length > 0 || talker.getState?.() === 'processing') {
        send({ type: 'error', requestId: payload?.requestId || null, message: 'Server busy' });
        return;
      }

      requestId = typeof payload.requestId === 'string' && payload.requestId ? payload.requestId : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const username = normalizeString(payload?.username);
      const message = normalizeString(payload?.message);

      const validation = validateInput(username, message);
      if (!validation.valid) {
        send({ type: 'error', requestId, message: validation.error });
        return;
      }

      wsActiveRequest = true;
      bound = true;
      talker.on('stream', onStream);
      talker.on('status', onStatus);
      talker.on('round_end', onRoundEnd);
      talker.on('end', onEnd);
      talker.on('error', onError);

      send({ type: 'ack', requestId });

      try {
        talker.talk(username, message);
      } catch (err) {
        onError(err);
      }
    });

    const abortActive = () => {
      if (!bound) return;
      if (wsActiveRequest && talker.getState?.() === 'processing') {
        try { talker.manualAbort?.('ws_closed'); } catch {}
        try { talker.abort?.('ws_closed'); } catch {}
      }
    };

    ws.on('close', () => {
      abortActive();
      cleanup();
    });
    ws.on('error', () => {
      abortActive();
      cleanup();
    });
  });
}

module.exports = {
  priority,

  /**
   * 啟動插件：向主服務 Express app 註冊路由
   * options:
   *  - expressApp: 由主服務注入的 Express app
   * 
   * 設計說明：
   *  - registered: 標記路由是否已註冊到 Express（路由無法動態解除，故僅註冊一次）
   *  - isOnline: 標記插件的運行狀態（允許 offline/online 切換）
   *  - 當 registered=true 且 isOnline=false 時，online() 會跳過路由註冊但更新 isOnline 狀態
   */
  async online(options = {}) {
    if (registered && isOnline) {
      logger.warn('[appChatService] 已上線，跳過重複 online');
      return true;
    }

    // 由主服務注入 Express app，不允許插件自行建立 server
    if (!options.expressApp) {
      logger.error('[appChatService] 缺少 Express app，無法註冊路由');
      return false;
    }

    expressApp = options.expressApp;
    httpServer = options.httpServer || httpServer;

    try {
      // 註冊路由到主服務 Express app
      if (!registered) {
        const router = buildRouter();
        expressApp.use(router);
        registered = true;
      }

      // WS 需要 httpServer 才能掛 upgrade
      if (httpServer) {
        registerWebSocket(httpServer);
      } else {
        logger.warn('[appChatService] 未提供 httpServer，WebSocket 端點將不會啟用（僅保留 HTTP）。');
      }

      isOnline = true;
      logger.info('[appChatService] 已註冊路由並完成上線');
      return true;
    } catch (err) {
      logger.error(`[appChatService] 啟動失敗: ${err?.message || err}`);
      isOnline = false;
      return false;
    }
  },

  /**
   * 關閉插件：僅更新狀態（Express 路由無法動態解除）
   * 注意：expressApp 引用保留以供重新上線時使用
   */
  async offline() {
    if (!registered) return true;

    // 無法解除路由，僅標記為離線，避免重複註冊
    // expressApp 引用保留，因為 Express 路由一旦註冊無法移除
    isOnline = false;
    logger.warn('[appChatService] 已標記離線（Express 路由仍保留）');
    return true;
  },

  async restart(options = {}) {
    await this.offline();
    return this.online(options);
  },

  async state() {
    return isOnline ? 1 : 0;
  }
};
