const axios = require('axios');
const Logger = require('../../../../utils/logger');
// 改為直接引用 server 策略的設定
const info = require('../server/infor');

const logger = new Logger('ASRRemote');
const priority = 90;

let baseUrl = '';

module.exports = {
  priority,
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
      const { data } = await axios.get(`${baseUrl}/${info.subdomain}/${info.routes.state}`, {
        timeout: 5000, // 5秒逾時
        headers: {
          'User-Agent': 'Demon-ASR-Remote/1.0.0'
        }
      });
      return Number(data?.state ?? 0);
    } catch (e) {
      if (e.code === 'ECONNABORTED') {
        logger.error('查詢遠端 ASR 狀態逾時');
      } else if (e.response?.status) {
        logger.error(`查詢遠端 ASR 狀態失敗 (HTTP ${e.response.status}): ${e.response.statusText}`);
      } else {
        logger.error('查詢遠端 ASR 狀態失敗: ' + e.message);
      }
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
    
    const startTime = Date.now();
    try {
      const url = `${baseUrl}/${info.subdomain}/${route}`;
      logger.info(`[ASRRemote] 執行 ${action} 指令: ${url}`);
      
      const res = await axios.post(url, {}, {
        timeout: 10000, // 10秒逾時
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Demon-ASR-Remote/1.0.0'
        },
        validateStatus: (status) => status < 600 // 允許所有狀態碼進行處理
      });

      const duration = Date.now() - startTime;
      
      if (res.status >= 500) {
        logger.error(`[ASRRemote] ${action} 執行失敗 (HTTP ${res.status}): 伺服器內部錯誤 (耗時 ${duration}ms)`);
        throw new Error(`遠端伺服器內部錯誤 (HTTP ${res.status})`);
      } else if (res.status >= 400) {
        logger.error(`[ASRRemote] ${action} 執行失敗 (HTTP ${res.status}): 用戶端錯誤 (耗時 ${duration}ms)`);
        throw new Error(`請求錯誤 (HTTP ${res.status})`);
      }
      
      logger.info(`[ASRRemote] ${action} 執行成功 (耗時 ${duration}ms)`);
      return res.data;
    } catch (e) {
      const duration = Date.now() - startTime;
      
      if (e.code === 'ECONNABORTED') {
        logger.error(`[ASRRemote] ${action} 執行逾時 (耗時 ${duration}ms)`);
        throw new Error(`遠端伺服器回應逾時`);
      } else if (e.code === 'ECONNREFUSED') {
        logger.error(`[ASRRemote] ${action} 執行失敗: 無法連接到遠端伺服器 (耗時 ${duration}ms)`);
        throw new Error(`無法連接到遠端伺服器`);
      } else if (e.message.includes('HTTP')) {
        // 重新拋出已處理的 HTTP 錯誤
        throw e;
      } else {
        logger.error(`[ASRRemote] ${action} 執行失敗: ${e.message} (耗時 ${duration}ms)`);
        throw e;
      }
    }
  }
};
