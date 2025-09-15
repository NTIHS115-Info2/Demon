const strategies = require('./strategies');
const Logger = require('../../utils/logger');

// 建立記錄器
const logger = new Logger('weatherSystem');

let strategy = null;
let mode = 'local'; // 預設僅支援本地策略

module.exports = {
  // 標示此插件為 LLM 工具
  pluginType: 'LLM',
  pluginName: 'weatherSystem',
  // 優先度將由策略決定
  priority: 0,
  /**
   * 更新策略模式
   * @param {string} newMode - 目前僅支援 'local'
   * @param {Object} options - 傳遞給策略的設定
   */
  async updateStrategy(newMode = 'local', options = {}) {
    logger.info('weatherSystem 插件更新策略中...');
    if (newMode !== 'local') {
      logger.warn(`不支援的模式 ${newMode}，已自動切換為 local`);
      newMode = 'local';
    }
    mode = newMode;
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info(`weatherSystem 已切換為 ${mode} 模式`);
  },

  /**
   * 啟動插件
   * @param {Object} options
   */
  async online(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
    try {
      await strategy.online(options);
    } catch (e) {
      logger.error('weatherSystem online 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 關閉插件
   */
  async offline() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      await strategy.offline();
    } catch (e) {
      logger.error('weatherSystem offline 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 重啟插件
   * @param {Object} options
   */
  async restart(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
    try {
      await strategy.restart(options);
    } catch (e) {
      logger.error('weatherSystem restart 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 取得插件狀態
   * @returns {Promise<number>}
   */
  async state() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('weatherSystem state 查詢錯誤: ' + e.message);
      return -1;
    }
  },

  /**
   * 傳送資料給插件並取得結果
   * @param {Object} data - API 參數
   * @returns {Promise<Object>}
   */
  async send(data = {}) {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.send(data);
    } catch (e) {
      logger.error('weatherSystem send 錯誤: ' + e.message);
      return { error: e.message };
    }
  }
};
