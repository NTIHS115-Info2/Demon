// ───────────────────────────────────────────────
// 區段：載入策略與記錄器
// 用途：準備插件的策略管理與日誌工具
// ───────────────────────────────────────────────
const strategies = require('./strategies');
const Logger = require('../../utils/logger');

// ───────────────────────────────────────────────
// 區段：建立記錄器
// 用途：輸出插件狀態與錯誤訊息
// ───────────────────────────────────────────────
const logger = new Logger('appVoiceMessageService');

// ───────────────────────────────────────────────
// 區段：策略狀態
// 用途：記錄當前策略與模式
// ───────────────────────────────────────────────
let strategy = null;
let mode = 'local';

module.exports = {
  /**
   * 更新策略模式
   * @param {string} newMode
   * @param {Object} options
   */
  async updateStrategy(newMode = 'local', options = {}) {
    // ───────────────────────────────────────────
    // 區段：策略切換邏輯
    // 用途：設定可用策略並同步 priority
    // ───────────────────────────────────────────
    logger.info('[appVoiceMessageService] 策略更新中...');
    if (!strategies[newMode]) {
      logger.warn(`[appVoiceMessageService] 不支援的模式 ${newMode}，已切換為 local`);
      newMode = 'local';
    }
    mode = newMode;
    strategy = strategies[newMode];
    this.priority = strategy.priority;
    logger.info(`[appVoiceMessageService] 策略已切換為 ${mode}`);
  },

  /**
   * 啟動插件
   * @param {Object} options
   */
  async online(options = {}) {
    // ───────────────────────────────────────────
    // 區段：啟動流程
    // 用途：確保策略可用並啟動服務
    // ───────────────────────────────────────────
    const useMode = options.mode || mode;

    // ───────────────────────────────────────────
    // 區段：參數正規化
    // 用途：統一使用 expressApp 參數以註冊路由
    // ───────────────────────────────────────────
    const normalizedOptions = { ...options };
    if (!normalizedOptions.expressApp && normalizedOptions.app) {
      logger.warn('[appVoiceMessageService] 偵測到 app 參數，已改用 expressApp 注入');
      normalizedOptions.expressApp = normalizedOptions.app;
    }

    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.online(normalizedOptions);
    } catch (err) {
      logger.error(`[appVoiceMessageService] online 失敗: ${err.message || err}`);
      throw err;
    }
  },

  /**
   * 關閉插件
   */
  async offline() {
    // ───────────────────────────────────────────
    // 區段：離線流程
    // 用途：釋放資源並解除路由
    // ───────────────────────────────────────────
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.offline();
    } catch (err) {
      logger.error(`[appVoiceMessageService] offline 失敗: ${err.message || err}`);
      throw err;
    }
  },

  /**
   * 重新啟動插件
   * @param {Object} options
   */
  async restart(options = {}) {
    // ───────────────────────────────────────────
    // 區段：重啟流程
    // 用途：重新載入策略並啟動
    // ───────────────────────────────────────────
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
    try {
      return await strategy.restart(options);
    } catch (err) {
      logger.error(`[appVoiceMessageService] restart 失敗: ${err.message || err}`);
      throw err;
    }
  },

  /**
   * 查詢插件狀態
   * @returns {Promise<number>}
   */
  async state() {
    // ───────────────────────────────────────────
    // 區段：狀態回報
    // 用途：回傳策略目前狀態
    // ───────────────────────────────────────────
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.state();
    } catch (err) {
      logger.error(`[appVoiceMessageService] state 查詢錯誤: ${err.message || err}`);
      return -1;
    }
  }
};
