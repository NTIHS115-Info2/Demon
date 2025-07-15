const NgrokServerManager = require('../../../../../Server/ngrok/ngrokServer');
const Logger = require('../../../../utils/logger');
const logger = new Logger('NgrokLocal');

let manager = null;

module.exports = {
  async online(options) {
    logger.info('Ngrok 正在啟動...');
    if (!manager) manager = new NgrokServerManager(options);
    return manager.start(options);
  },

  async offline() {
    if (!manager) {
      logger.warn('Ngrok 尚未啟動');
      return false;
    }
    return manager.stop();
  },

  async restart(options) {
    if (!manager) manager = new NgrokServerManager(options);
    return manager.restart(options);
  },

  async state() {
    if (!manager) return 0;
    return manager.isRunning() ? 1 : 0;
  },

  /**
   * 與外界互動的入口，處理註冊與解註冊等指令
   * @param {Object} options - 傳入的資料表
   * @param {string} options.action - 動作名稱(register 或 unregister)
   * @returns {boolean}
   */
  async send(options = {}) {
    if (!manager) {
      logger.warn('Ngrok 尚未啟動');
      return false;
    }

    const { action } = options;
    switch (action) {
      case 'register': {
        const { subdomain, handler } = options;
        if (!subdomain || typeof handler !== 'function') {
          logger.error('註冊子網域參數錯誤');
          return false;
        }
        return manager.registerSubdomain(subdomain, handler);
      }
      case 'unregister': {
        const { subdomain } = options;
        if (!subdomain) {
          logger.error('解除子網域參數錯誤');
          return false;
        }
        return manager.unregisterSubdomain(subdomain);
      }
      default:
        logger.error(`未知的 action: ${action}`);
        return false;
    }
  }
};
