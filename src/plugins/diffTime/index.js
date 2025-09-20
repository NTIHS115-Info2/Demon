const strategies = require('./strategies');
const Logger = require('../../utils/logger');

// 建立記錄器
const logger = new Logger('diffTime');

let strategy = null;
let mode = 'local'; // 目前僅支援 local 策略

module.exports = {
  /**
   * 更新策略模式
   * @param {string} newMode - 目前僅支援 'local' 模式
   * @param {Object} options - 傳遞給策略的設定
   */
  async updateStrategy(newMode = 'local', options = {}) {
    logger.info('diffTime 插件更新策略中...');
    if (newMode !== 'local') {
      logger.warn(`不支援的模式 ${newMode}，已自動切換為 local`);
      newMode = 'local';
    }
    mode = newMode;
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info(`diffTime 已切換為 ${mode} 模式`);
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
      logger.error('diffTime online 錯誤: ' + e.message);
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
      logger.error('diffTime offline 錯誤: ' + e.message);
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
      logger.error('diffTime restart 錯誤: ' + e.message);
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
      logger.error('diffTime state 查詢錯誤: ' + e.message);
      return -1;
    }
  },

  /**
   * 傳送資料給插件並取得結果
   * @param {Object} data - 時間計算設定
   * @returns {Promise<Object>}
   */
  async send(data = {}) {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.send(data);
    } catch (e) {
      logger.error('diffTime send 錯誤: ' + e.message);
      return { error: e.message };
    }
  }
};
