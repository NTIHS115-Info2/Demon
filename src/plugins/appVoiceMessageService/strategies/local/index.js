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
    // 區段：輸入檢查
    // 用途：確保已注入 Express app，避免無法掛載路由
    // ───────────────────────────────────────────
    const app = options.app;
    if (!app || typeof app.post !== 'function') {
      logger.error('[appVoiceMessageService] 缺少有效的 Express app，無法掛載路由');
      return false;
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
    // 注意：路由僅在首次呼叫 online 時註冊。若插件重啟或使用
    //       不同的 Express app 實例，路由將不會重新註冊。
    // ───────────────────────────────────────────
    if (!registered) {
      app.post(
        ROUTE_VOICE_MESSAGE,
        pipeline.prepareRequestMiddleware(),
        pipeline.uploadMiddleware(),
        pipeline.handleVoiceMessage.bind(pipeline)
      );

      app.get(ROUTE_HEALTH, pipeline.handleHealth.bind(pipeline));

      registered = true;
      logger.info('[appVoiceMessageService] 路由已掛載完成');
    }

    onlineState = true;
    logger.info('[appVoiceMessageService] local 策略已上線');
    return true;
  },

  /**
   * 關閉插件
   * 注意：此方法僅更新服務狀態旗標，不會移除已掛載的路由。
   * 已註冊的路由將保持活動狀態，但 onlineState 標記為離線。
   */
  async offline() {
    // ───────────────────────────────────────────
    // 區段：離線處理
    // 用途：更新服務狀態，保留已掛載路由
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
