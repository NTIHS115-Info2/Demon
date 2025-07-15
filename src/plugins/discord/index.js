const local = require('./strategies/local');
const Logger = require('../../utils/logger');
const logger = new Logger('DISCORD');

let strategy = null;

module.exports = {
  async updateStrategy() {
    logger.info('Discord 插件策略更新中...');
    strategy = local;
    logger.info('Discord 插件策略已載入');
  },

  async online(options) {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.online(options);
    } catch (e) {
      logger.error('[DISCORD] online 發生錯誤: ' + e);
      throw e;
    }
  },

  async offline() {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.offline();
    } catch (e) {
      logger.error('[DISCORD] offline 發生錯誤: ' + e);
      throw e;
    }
  },

  async restart(options) {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.restart(options);
    } catch (e) {
      logger.error('[DISCORD] restart 發生錯誤: ' + e);
      throw e;
    }
  },

  async state() {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('[DISCORD] state 查詢錯誤: ' + e);
      return -1;
    }
  },

  // 將外部傳入的指令分派至內部對應函式
  async send(data = {}) {
    if (!strategy) await this.updateStrategy();
    if (!data.func) return false;
    const { func, ...params } = data;
    try {
      // 優先執行插件本身的函式
      if (func !== 'send' && typeof this[func] === 'function') {
        return await this[func](params);
      }
      // 其次尋找策略中的函式
      if (strategy && typeof strategy[func] === 'function') {
        return await strategy[func](params);
      }
      logger.warn(`[DISCORD] 未找到 func: ${func}`);
      return false;
    } catch (e) {
      logger.error(`[DISCORD] send 執行 ${func} 錯誤: ` + e);
      return false;
    }
  }
};
