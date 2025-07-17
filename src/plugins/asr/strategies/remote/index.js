const axios = require('axios');
const Logger = require('../../../../utils/logger');
const info = require('./infor');

const logger = new Logger('ASRRemote');
let baseUrl = '';

module.exports = {
  /**
   * 啟動遠端策略，設定伺服器 baseUrl
   * @param {{baseUrl:string}} options
   */
  async online(options = {}) {
    if (!options.baseUrl) {
      throw new Error('遠端模式需要提供 baseUrl');
    }
    baseUrl = options.baseUrl.replace(/\/$/, '');
    logger.info(`ASR remote 已設定 baseUrl: ${baseUrl}`);
    return true;
  },

  /** 關閉遠端策略 */
  async offline() {
    baseUrl = '';
    logger.info('ASR remote 已關閉');
    return true;
  },

  /** 重新啟動遠端策略 */
  async restart(options) {
    await this.offline();
    return this.online(options);
  },

  /** 查詢遠端狀態 */
  async state() {
    if (!baseUrl) return 0;
    try {
      const { data } = await axios.get(`${baseUrl}/${info.subdomain}/${info.routes.state}`);
      return Number(data?.state ?? 0);
    } catch (e) {
      logger.error('查詢遠端 ASR 狀態失敗: ' + e.message);
      return -1;
    }
  },

  /**
   * 向遠端伺服器發送指令
   * @param {'start'|'stop'|'restart'} action
   */
  async send(action = 'start') {
    if (!baseUrl) throw new Error('遠端未初始化');
    const route = info.routes[action];
    if (!route) throw new Error(`未知的指令: ${action}`);
    try {
      const url = `${baseUrl}/${info.subdomain}/${route}`;
      const res = await axios.post(url);
      return res.data;
    } catch (e) {
      logger.error(`[ASRRemote] ${action} 執行失敗: ${e.message}`);
      throw e;
    }
  }
};
