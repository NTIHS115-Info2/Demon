const Logger = require('../../../../utils/logger');
const { normalizeOptions, buildTime } = require('../../utils/timeUtil');

// 建立記錄器，方便追蹤與除錯
const logger = new Logger('timeService-local');

// 此策略的預設啟動優先度
const priority = 10;
let onlineState = false;

module.exports = {
  priority,
  /**
   * 啟動本地時間服務
   * @returns {Promise<void>}
   */
  async online() {
    onlineState = true;
    logger.info('本地 timeService 已上線');
  },

  /**
   * 關閉本地時間服務
   * @returns {Promise<void>}
   */
  async offline() {
    onlineState = false;
    logger.info('本地 timeService 已離線');
  },

  /**
   * 重啟本地時間服務
   * @returns {Promise<void>}
   */
  async restart() {
    await this.offline();
    await this.online();
  },

  /**
   * 回傳目前服務狀態
   * @returns {Promise<number>} 1: 上線, 0: 離線
   */
  async state() {
    return onlineState ? 1 : 0;
  },

  /**
   * 接收時間偏移參數並回傳計算結果
   * @param {Object} data - 時間偏移設定
   * @returns {Promise<Object>} 計算結果或錯誤訊息
   */
  async send(data = {}) {
    if (!onlineState) {
      return { error: 'timeService 尚未上線' };
    }
    try {
      const opts = normalizeOptions(data);
      const base = new Date();
      const result = buildTime(base, opts);
      return { result };
    } catch (e) {
      logger.error('本地時間計算失敗: ' + e.message);
      return { error: e.message };
    }
  }
};
