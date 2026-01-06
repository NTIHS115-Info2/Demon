// ───────────────────────────────────────────────
// 區段：載入相依模組
// 用途：準備核心對話入口、插件管理器與記錄器
// ───────────────────────────────────────────────
const talker = require('../../../../core/TalkToDemon.js');
const pluginsManager = require('../../../../core/pluginsManager');
const Logger = require('../../../../utils/logger');

// ───────────────────────────────────────────────
// 區段：建立記錄器
// 用途：輸出插件日誌，便於追蹤服務流程
// ───────────────────────────────────────────────
const logger = new Logger('appChatService.log');

// ───────────────────────────────────────────────
// 區段：基礎常數與狀態
// 用途：定義子網域、路由與啟動狀態
// ───────────────────────────────────────────────
const SUBDOMAIN = 'ios-app';
const ROUTE_PATH = '/chat';
const DEFAULT_TIMEOUT_MS = 60000;
const priority = 85;
let registered = false;

// ───────────────────────────────────────────────
// 區段：統一錯誤訊息
// 用途：回傳對外一致的錯誤提示文字
// ───────────────────────────────────────────────
const GENERIC_ERROR_MESSAGE = '系統暫時無法處理，請稍後再試。';

// ───────────────────────────────────────────────
// 區段：字串正規化工具
// 用途：確保輸入為字串並完成 trim
// ───────────────────────────────────────────────
function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

// ───────────────────────────────────────────────
// 區段：回傳統一錯誤回應
// 用途：封裝 HTTP 錯誤回應格式
// ───────────────────────────────────────────────
function sendErrorResponse(res, statusCode) {
  return res.status(statusCode).json({ message: GENERIC_ERROR_MESSAGE });
}

// ───────────────────────────────────────────────
// 區段：收集 LLM 串流回應
// 用途：監聽 TalkToDemon 串流事件並累積回應內容
// ───────────────────────────────────────────────
function collectTalkerResponse(username, message, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let buffer = '';
    let finished = false;
    let timeoutId = null;

    // ───────────────────────────────────────────
    // 區段：統一清理函式
    // 用途：避免事件監聽殘留造成記憶體洩漏
    // ───────────────────────────────────────────
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      talker.off('data', onData);
      talker.off('end', onEnd);
      talker.off('error', onError);
      talker.off('abort', onAbort);
    };

    // ───────────────────────────────────────────
    // 區段：串流資料事件
    // 用途：接收並累積 LLM 回應內容
    // ───────────────────────────────────────────
    const onData = (chunk) => {
      if (finished) return;
      buffer += chunk || '';
    };

    // ───────────────────────────────────────────
    // 區段：串流結束事件
    // 用途：完成回應收集並回傳結果
    // ───────────────────────────────────────────
    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(buffer);
    };

    // ───────────────────────────────────────────
    // 區段：串流錯誤事件
    // 用途：捕捉錯誤並回傳拒絕
    // ───────────────────────────────────────────
    const onError = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err || new Error('LLM 串流錯誤'));
    };

    // ───────────────────────────────────────────
    // 區段：串流中止事件
    // 用途：處理中止情境並回傳錯誤
    // ───────────────────────────────────────────
    const onAbort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('LLM 串流中止'));
    };

    // ───────────────────────────────────────────
    // 區段：註冊事件監聽
    // 用途：先綁定事件再啟動對話，避免遺漏資料
    // ───────────────────────────────────────────
    talker.on('data', onData);
    talker.on('end', onEnd);
    talker.on('error', onError);
    talker.on('abort', onAbort);

    // ───────────────────────────────────────────
    // 區段：啟動超時機制
    // 用途：避免長時間等待造成請求卡住
    // ───────────────────────────────────────────
    timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('LLM 回應逾時'));
    }, timeoutMs);

    // ───────────────────────────────────────────
    // 區段：呼叫 LLM 對話入口
    // 用途：使用既有 talker.talk 觸發對話流程
    // ───────────────────────────────────────────
    try {
      talker.talk(username, message);
    } catch (err) {
      finished = true;
      cleanup();
      reject(err);
    }
  });
}

// ───────────────────────────────────────────────
// 區段：組裝請求路由處理器
// 用途：符合 /ios-app/chat 規格並回傳 non-stream 回應
// ───────────────────────────────────────────────
function buildRequestHandler() {
  return async (req, res) => {
    // ───────────────────────────────────────────
    // 區段：路由與方法檢查
    // 用途：確保只接受 POST /ios-app/chat
    // ───────────────────────────────────────────
    const requestPath = `/${req.params[0] || ''}`;
    if (req.method !== 'POST' || requestPath !== ROUTE_PATH) {
      return res.status(404).json({ message: GENERIC_ERROR_MESSAGE });
    }

    // ───────────────────────────────────────────
    // 區段：Content-Type 檢查
    // 用途：確保請求為 JSON
    // ───────────────────────────────────────────
    if (!req.is('application/json')) {
      logger.warn('[appChatService] Content-Type 非 JSON');
      return sendErrorResponse(res, 415);
    }

    // ───────────────────────────────────────────
    // 區段：Payload 解析與驗證
    // 用途：確保 username 與 message 合法
    // ───────────────────────────────────────────
    const username = normalizeString(req.body?.username);
    const message = normalizeString(req.body?.message);
    if (!username || !message) {
      logger.warn('[appChatService] 收到無效 payload');
      return sendErrorResponse(res, 400);
    }

    // ───────────────────────────────────────────
    // 區段：呼叫 LLM 並累積回應
    // 用途：收集串流內容後回傳完整訊息
    // ───────────────────────────────────────────
    try {
      const responseText = await collectTalkerResponse(username, message, {
        timeoutMs: DEFAULT_TIMEOUT_MS
      });
      return res.status(200).json({ message: responseText });
    } catch (err) {
      logger.error(`[appChatService] LLM 回應失敗: ${err.message || err}`);
      return sendErrorResponse(res, 500);
    }
  };
}

module.exports = {
  priority,
  /**
   * 啟動插件並註冊路由
   * @param {Object} options
   */
  async online(options = {}) {
    // ───────────────────────────────────────────
    // 區段：重複啟動防護
    // 用途：避免重複註冊造成衝突
    // ───────────────────────────────────────────
    if (registered) {
      logger.warn('[appChatService] 插件已經註冊，跳過重複啟動');
      return true;
    }

    // ───────────────────────────────────────────
    // 區段：註冊子網域路由
    // 用途：透過既有 HTTP Server 進行路由註冊
    // ───────────────────────────────────────────
    try {
      const handler = buildRequestHandler();
      const result = await pluginsManager.send('ngrok', {
        action: 'register',
        subdomain: SUBDOMAIN,
        handler
      });
      if (!result) {
        logger.error('[appChatService] 註冊子網域失敗');
        return false;
      }
      registered = true;
      logger.info('[appChatService] 子網域註冊完成');
      return true;
    } catch (err) {
      logger.error(`[appChatService] 啟動失敗: ${err.message || err}`);
      return false;
    }
  },

  /**
   * 關閉插件並解除註冊
   */
  async offline() {
    // ───────────────────────────────────────────
    // 區段：解除註冊處理
    // 用途：離線時釋放既有路由
    // ───────────────────────────────────────────
    if (registered) {
      try {
        await pluginsManager.send('ngrok', { action: 'unregister', subdomain: SUBDOMAIN });
      } catch (err) {
        logger.error(`[appChatService] 解除註冊失敗: ${err.message || err}`);
      }
    }
    registered = false;
    return true;
  },

  /**
   * 重新啟動插件
   * @param {Object} options
   */
  async restart(options = {}) {
    // ───────────────────────────────────────────
    // 區段：重啟流程
    // 用途：先離線再上線
    // ───────────────────────────────────────────
    await this.offline();
    return this.online(options);
  },

  /**
   * 查詢插件狀態
   * @returns {Promise<number>}
   */
  async state() {
    // ───────────────────────────────────────────
    // 區段：狀態回報
    // 用途：提供插件狀態給管理器
    // ───────────────────────────────────────────
    return registered ? 1 : 0;
  }
};
