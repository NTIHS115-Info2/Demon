const axios = require('axios');
const Logger = require('../../../../utils/logger');
const info = require('./infor');

const logger = new Logger('TTSRemote');
let baseUrl = '';

module.exports = {
  /**
   * 啟動遠端策略
   * @param {{baseUrl:string}} options
   */
  async online(options = {}) {
    if (!options.baseUrl) {
      throw new Error('遠端模式需要提供 baseUrl');
    }
    baseUrl = options.baseUrl.replace(/\/$/, '');
    logger.info(`TTS remote 已設定 baseUrl: ${baseUrl}`);
    return true;
  },

  /** 關閉遠端策略 */
  async offline() {
    baseUrl = '';
    logger.info('TTS remote 已關閉');
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
   * 將文字傳送給遠端伺服器
   * @param {string} text
   */
  async send(text = '') {
    if (!baseUrl) throw new Error('遠端未初始化');
    try {
      await axios.post(`${baseUrl}/${info.subdomain}/${info.routes.send}`, { text });
      return true;
    } catch (e) {
      logger.error('TTS 遠端發送失敗: ' + e.message);
      throw e;
    }
  }
};
