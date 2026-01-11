const strategies = require('./strategies');
const Logger = require('../../utils/logger');

// 檔案用途：統一管理 iotVisionTurret 插件策略切換與對外介面

// 建立記錄器（對外顯示名稱統一為 iotVisionTurret）
const logger = new Logger('iotVisionTurret');

// 狀態資料結構區塊：保存當前策略與模式
let strategy = null;
let mode = 'local';

module.exports = {
  /**
   * 更新策略模式（僅允許 local）
   * @param {string} newMode - 指定策略模式
   * @param {Object} options - 傳遞給策略的設定
   */
  async updateStrategy(newMode = 'local', options = {}) {
    logger.info('iotVisionTurret 插件更新策略中...');
    if (newMode !== 'local') {
      logger.warn(`不支援的模式 ${newMode}，已自動切換為 local`);
      newMode = 'local';
    }
    if (!strategies.local) {
      const message = '找不到 local 策略實作';
      logger.error(message);
      throw new Error(message);
    }
    mode = newMode;
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info(`iotVisionTurret 已切換為 ${mode} 模式`);
  },

  /**
   * 啟動插件
   * @param {Object} options - 啟動設定
   */
  async online(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) {
      await this.updateStrategy(useMode, options);
    }
    try {
      await strategy.online(options);
      logger.info('iotVisionTurret 插件已成功上線');
    } catch (e) {
      logger.error('iotVisionTurret online 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 關閉插件
   */
  async offline() {
    if (!strategy) {
      await this.updateStrategy(mode);
    }
    try {
      await strategy.offline();
      logger.info('iotVisionTurret 插件已離線');
    } catch (e) {
      logger.error('iotVisionTurret offline 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 重啟插件
   * @param {Object} options - 重啟設定
   */
  async restart(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) {
      await this.updateStrategy(useMode, options);
    }
    try {
      await strategy.restart(options);
    } catch (e) {
      logger.error('iotVisionTurret restart 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 取得插件狀態
   * @returns {Promise<number>} 狀態碼：1=online, 0=offline, -1=error
   */
  async state() {
    if (!strategy) {
      await this.updateStrategy(mode);
    }
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('iotVisionTurret state 查詢錯誤: ' + e.message);
      return -1;
    }
  },

  /**
   * 傳送資料給插件並取得結果
   * @param {Object} data - 影像或控制指令參數
   * @returns {Promise<boolean>} 是否成功傳送
   */
  async send(data = {}) {
    if (!strategy) {
      await this.updateStrategy(mode);
    }
    if (typeof strategy.send !== 'function') {
      return false;
    }
    return await strategy.send(data);
  }
};
