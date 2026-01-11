const axios = require('axios');
const Logger = require('../../../../utils/logger');
// 改為直接引用 server 策略的設定
const info = require('../server/infor');

// 設定遠端策略的 logger 名稱，對外顯示 ttsEngine
const logger = new Logger('ttsEngineRemote');
const priority = 90;

let baseUrl = '';

module.exports = {
  priority,
  /**
   * 啟動遠端策略
   * @param {{baseUrl:string}} options
   */
  async online(options = {}) {
    if (!options.baseUrl) {
      throw new Error('遠端模式需要提供 baseUrl');
    }
    baseUrl = options.baseUrl.replace(/\/$/, '');
    logger.info(`ttsEngine remote 已設定 baseUrl: ${baseUrl}`);
    return true;
  },

  /** 關閉遠端策略 */
  async offline() {
    baseUrl = '';
    logger.info('ttsEngine remote 已關閉');
    return true;
  },

  /** 重新啟動遠端策略 */
  async restart(options) {
    await this.offline();
    return this.online(options);
  },

  /** 狀態：有設定 baseUrl 即視為啟用 */
  async state() {
    return baseUrl ? 1 : 0;
  },

  /**
   * 將文字傳送給遠端伺服器並回傳音訊資料
   * @param {string} text
   */
  async send(text = '') {
    if (!baseUrl) throw new Error('遠端未初始化');
    try {
      // 方案 A：回傳完整音訊資料與 metadata，交由呼叫端自行處理播放或保存
      const response = await axios.post(`${baseUrl}/${info.subdomain}/${info.routes.send}`, { text });
      return response.data;
    } catch (e) {
      logger.error('ttsEngine 遠端發送失敗: ' + e.message);
      throw e;
    }
  }
};
