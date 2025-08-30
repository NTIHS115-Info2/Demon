const Logger = require('../../../../utils/logger');
const { parseTimeString, diffTime } = require('../../../../utils/timeUtil');

// 建立記錄器
const logger = new Logger('diffTime-local');

// 預設啟動優先度
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
    logger.info('本地 diffTime 已上線');
  },

  /**
   * 關閉本地時間服務
   * @returns {Promise<void>}
   */
  async offline() {
    onlineState = false;
    logger.info('本地 diffTime 已離線');
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
   * 接收基準與目標時間並回傳差距
   * @param {Object} data - 時間計算設定
   * @returns {Promise<Object>} 計算結果或錯誤訊息
   */
  async send(data = {}) {
    if (!onlineState) {
      return { error: 'diffTime 尚未上線' };
    }
    try {
      const { baseTime, targetTime } = data;
      if (!targetTime) {
        return { error: '缺少 targetTime' };
      }

      // 固定使用 UTC+8 解析時間
      const timezone = 8;
      const baseUTC = baseTime
        ? parseTimeString(baseTime, timezone)
        : new Date();
      const targetUTC = parseTimeString(targetTime, timezone);
      const { formatted } = diffTime(baseUTC, targetUTC);
      return { result: formatted, resultType: 'time' };
    } catch (e) {
      logger.error('本地時間差計算失敗: ' + e.message);
      return { error: e.message };
    }
  }
};
