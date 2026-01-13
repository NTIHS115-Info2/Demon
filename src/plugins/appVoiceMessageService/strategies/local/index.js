const Logger = require('../../../../utils/logger');
const VoiceMessagePipeline = require('./VoiceMessagePipeline');

// ───────────────────────────────────────────────
// 區段：基本設定
// 用途：定義路由與優先度等固定配置
// ───────────────────────────────────────────────
const priority = 75;
const ROUTE_VOICE_MESSAGE = '/app/voice/message';
const ROUTE_HEALTH = '/app/voice/health';

// ───────────────────────────────────────────────
// 區段：狀態管理
// 用途：追蹤是否已掛載路由與服務狀態
// ───────────────────────────────────────────────
let registered = false;
let onlineState = false;
let pipeline = null;

// ───────────────────────────────────────────────
// 區段：Express app 參考
// 用途：保留主服務注入的 Express app 實例，便於重啟判斷
// ───────────────────────────────────────────────
let expressApp = null;

// ───────────────────────────────────────────────
// 區段：記錄器
// 用途：統一輸出插件日誌
// ───────────────────────────────────────────────
const logger = new Logger('appVoiceMessageService-local');

module.exports = {
  priority,

  /**
   * 啟動插件（掛載路由）
   * @param {Object} options
   */
  async online(options = {}) {
    // ───────────────────────────────────────────
    // 區段：重複上線檢查
    // 用途：避免重複上線時重複註冊路由
    // 說明：僅檢查 onlineState 以允許 offline 後重新 online 的流程。
    //       即使 registered 為 true，路由也不會重複註冊（見下方 !registered 檢查）。
    // ───────────────────────────────────────────
    if (onlineState) {
      logger.warn('[appVoiceMessageService] 已上線，跳過重複 online');
      return true;
    }

    // ───────────────────────────────────────────
    // 區段：輸入檢查
    // 用途：確保已注入 Express app，避免無法掛載路由
    // ───────────────────────────────────────────
    const injectedApp = options.expressApp;
    if (!injectedApp || typeof injectedApp.post !== 'function') {
      logger.error('[appVoiceMessageService] 缺少有效的 Express app，無法掛載路由');
      return false;
    }

    // ───────────────────────────────────────────
    // 區段：app 實例檢查
    // 用途：提示若已註冊路由卻注入不同 app，避免誤以為會重新掛載
    // ───────────────────────────────────────────
    if (registered && expressApp && expressApp !== injectedApp) {
      logger.warn('[appVoiceMessageService] 已註冊路由但收到不同 Express app，將維持既有路由於原 app 實例');
      // 不更新 expressApp 參考，保持指向原有的 app 實例
    } else {
      // ─────────────────────────────────────────
      // 區段：保存 app 參考
      // 用途：記錄目前注入的 Express app 以供後續判斷
      // ─────────────────────────────────────────
      expressApp = injectedApp;
    }

    // ───────────────────────────────────────────
    // 區段：建立處理管線
    // 用途：集中管理語音處理流程與中介層
    // ───────────────────────────────────────────
    if (!pipeline) {
      pipeline = new VoiceMessagePipeline({ logger });
    }

    // ───────────────────────────────────────────
    // 區段：掛載路由
    // 用途：僅註冊一次路由，避免重複掛載
    // 說明：若插件以不同 Express app 實例重啟，路由不會重新註冊到新實例。
    //       此為預期行為，因通常整個應用共用同一個 app 實例。
    // ───────────────────────────────────────────
    try {
      // ─────────────────────────────────────────
      // 區段：掛載路由
      // 用途：僅註冊一次路由，避免重複掛載
      // 說明：若插件以不同 Express app 實例重啟，路由不會重新註冊到新實例。
      //       此為預期行為，因通常整個應用共用同一個 app 實例。
      // ─────────────────────────────────────────
      if (!registered) {
        expressApp.post(
          ROUTE_VOICE_MESSAGE,
          pipeline.prepareRequestMiddleware(),
          pipeline.uploadMiddleware(),
          pipeline.handleVoiceMessage.bind(pipeline)
        );

        expressApp.get(ROUTE_HEALTH, pipeline.handleHealth.bind(pipeline));

        registered = true;
        logger.info('[appVoiceMessageService] 路由已掛載完成');
      }

      // ─────────────────────────────────────────
      // 區段：上線狀態更新
      // 用途：標記插件已成功上線
      // ─────────────────────────────────────────
      onlineState = true;
      logger.info('[appVoiceMessageService] local 策略已上線');
      return true;
    } catch (error) {
      // ─────────────────────────────────────────
      // 區段：錯誤處理
      // 用途：記錄掛載失敗原因並回報結果
      // ─────────────────────────────────────────
      onlineState = false;
      registered = false;
      logger.error(`[appVoiceMessageService] 路由掛載失敗: ${error?.message || error}`);
      return false;
    }
  },

  /**
   * 關閉插件
   */
  async offline() {
    // ───────────────────────────────────────────
    // 區段：離線處理
    // 用途：更新服務狀態，保留已掛載路由
    // 說明：路由仍會保持活躍並可處理請求，此為預期行為。
    //       若需完全停止處理，應在 handleVoiceMessage 中檢查 onlineState。
    // ───────────────────────────────────────────
    onlineState = false;
    logger.info('[appVoiceMessageService] local 策略已離線');
    return true;
  },

  /**
   * 重啟插件
   * @param {Object} options
   */
  async restart(options = {}) {
    // ───────────────────────────────────────────
    // 區段：重啟流程
    // 用途：依序離線與重新上線
    // ───────────────────────────────────────────
    await this.offline();
    return this.online(options);
  },

  /**
   * 回傳服務狀態
   * @returns {Promise<number>}
   */
  async state() {
    // ───────────────────────────────────────────
    // 區段：狀態回報
    // 用途：提供插件管理器查詢
    // ───────────────────────────────────────────
    return onlineState ? 1 : 0;
  }
};
