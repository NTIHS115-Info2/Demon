const Logger = require('../../../../utils/logger');
const {
  normalizeOptions,
  parseTimeString,
  applyOffset,
  formatTime
} = require('../../../../utils/timeUtil');

// 建立記錄器
const logger = new Logger('getTime-local');

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
    logger.info('本地 getTime 已上線');
  },

  /**
   * 關閉本地時間服務
   * @returns {Promise<void>}
   */
  async offline() {
    onlineState = false;
    logger.info('本地 getTime 已離線');
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
      return { error: 'getTime 尚未上線' };
    }
    try {
      // 解析並正規化輸入參數
      const opts = normalizeOptions(data);

      // getTime 僅提供取得當前時間與偏移，不支援指定基準時間或目標時間
      if (opts.targetTime !== undefined) {
        return { error: '不支援 targetTime' };
      }
      if (opts.baseTime !== undefined) {
        return { error: '不支援 baseTime' };
      }

      // 以現在時間作為基準時間後套用偏移量
      const baseUTC = new Date();
      const baseAfterOffset = applyOffset(baseUTC, opts);
      const result = formatTime(baseAfterOffset, opts.timezone);
      return { result, resultType: 'time' };
    } catch (e) {
      logger.error('本地時間計算失敗: ' + e.message);
      return { error: e.message };
    }
  }
};
