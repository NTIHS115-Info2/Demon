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
   * @returns {Promise<Object>} 更新結果
   */
  async updateStrategy(newMode = 'local', options = {}) {
    try {
      logger.info('iotVisionTurret 插件更新策略中...');
      if (newMode !== 'local') {
        const message = `不支援的模式 ${newMode}，僅允許 local`;
        logger.error(message);
        return { ok: false, error: { message, code: 'MODE_NOT_ALLOWED' } };
      }
      if (!strategies.local) {
        const message = '找不到 local 策略實作';
        logger.error(message);
        return { ok: false, error: { message, code: 'LOCAL_STRATEGY_MISSING' } };
      }
      mode = newMode;
      strategy = strategies.local;
      this.priority = strategy.priority;
      logger.info(`iotVisionTurret 已切換為 ${mode} 模式`);
      return { ok: true, mode };
    } catch (e) {
      logger.error('iotVisionTurret updateStrategy 錯誤: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'UPDATE_STRATEGY_ERROR', details: e } };
    }
  },

  /**
   * 啟動插件
   * @param {Object} options - 啟動設定
   * @returns {Promise<Object>} 啟動結果
   */
  async online(options = {}) {
    try {
      const useMode = options.mode || mode;
      if (!strategy || useMode !== mode) {
        const updateResult = await this.updateStrategy(useMode, options);
        if (!updateResult.ok) return updateResult;
      }
      return await strategy.online(options);
    } catch (e) {
      logger.error('iotVisionTurret online 錯誤: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'ONLINE_ERROR', details: e } };
    }
  },

  /**
   * 關閉插件
   * @returns {Promise<Object>} 關閉結果
   */
  async offline() {
    try {
      if (!strategy) {
        const updateResult = await this.updateStrategy(mode);
        if (!updateResult.ok) return updateResult;
      }
      return await strategy.offline();
    } catch (e) {
      logger.error('iotVisionTurret offline 錯誤: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'OFFLINE_ERROR', details: e } };
    }
  },

  /**
   * 重啟插件
   * @param {Object} options - 重啟設定
   * @returns {Promise<Object>} 重啟結果
   */
  async restart(options = {}) {
    try {
      const useMode = options.mode || mode;
      if (!strategy || useMode !== mode) {
        const updateResult = await this.updateStrategy(useMode, options);
        if (!updateResult.ok) return updateResult;
      }
      return await strategy.restart(options);
    } catch (e) {
      logger.error('iotVisionTurret restart 錯誤: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'RESTART_ERROR', details: e } };
    }
  },

  /**
   * 取得插件狀態
   * @returns {Promise<Object>} 狀態結果
   */
  async state() {
    try {
      if (!strategy) {
        const updateResult = await this.updateStrategy(mode);
        if (!updateResult.ok) return updateResult;
      }
      return await strategy.state();
    } catch (e) {
      logger.error('iotVisionTurret state 查詢錯誤: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'STATE_ERROR', details: e } };
    }
  },

  /**
   * 傳送資料給插件並取得結果
   * @param {Object} data - 影像或控制指令參數
   * @returns {Promise<Object>} 傳送結果
   */
  async send(data = {}) {
    try {
      if (!strategy) {
        const updateResult = await this.updateStrategy(mode);
        if (!updateResult.ok) return updateResult;
      }
      return await strategy.send(data);
    } catch (e) {
      logger.error('iotVisionTurret send 錯誤: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'SEND_ERROR', details: e } };
    }
  }
};
