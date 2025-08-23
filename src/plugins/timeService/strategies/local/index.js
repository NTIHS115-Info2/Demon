const Logger = require('../../../../utils/logger');
const {
  normalizeOptions,
  parseTimeString,
  applyOffset,
  formatTime,
  diffTime
} = require('../../utils/timeUtil');

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
      // 解析並正規化輸入參數
      const opts = normalizeOptions(data);
      const { timezone, baseTime, targetTime } = opts;

      // 建立基準時間（若有 baseTime 則解析，否則以現在時間為基準）
      const baseUTC = baseTime ? parseTimeString(baseTime, timezone) : new Date();

      // 套用偏移量後的基準時間
      const baseAfterOffset = applyOffset(baseUTC, opts);

      // 若僅提供 baseTime 而沒有 targetTime，依規範回傳錯誤碼
      if (baseTime && !targetTime) {
        return { error: 'IGNORED_BASE_ONLY' };
      }

      // 若提供 targetTime，計算差距
      if (targetTime) {
        const targetUTC = parseTimeString(targetTime, timezone);
        const { formatted } = diffTime(baseAfterOffset, targetUTC);
        return { result: formatted, resultType: 'time' };
      }

      // 未提供 targetTime，回傳時間結果
      const result = formatTime(baseAfterOffset, timezone);
      return { result, resultType: 'time' };
    } catch (e) {
      logger.error('本地時間計算失敗: ' + e.message);
      return { error: e.message };
    }
  }
};
