const local = require('./strategies/local');
const Logger = require('../../utils/logger');
const logger = new Logger('Ngrok');

let strategy = null;

module.exports = {
  async updateStrategy() {
    logger.info('Ngrok 策略更新中...');
    strategy = local;
    logger.info('Ngrok 策略已載入');
  },

  async online(options) {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.online(options);
    } catch (e) {
      logger.error('[Ngrok] online 發生錯誤: ' + e);
      throw e;
    }
  },

  async offline() {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.offline();
    } catch (e) {
      logger.error('[Ngrok] offline 發生錯誤: ' + e);
      throw e;
    }
  },

  async restart(options) {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.restart(options);
    } catch (e) {
      logger.error('[Ngrok] restart 發生錯誤: ' + e);
      throw e;
    }
  },

  async state() {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('[Ngrok] state 查詢錯誤: ' + e);
      return -1;
    }
  },

  /** 選用函式，用來與策略互動 */
  async send(data) {
    if (!strategy || typeof strategy.send !== 'function') {
      return false;
    }
    try {
      return await strategy.send(data);
    } catch (e) {
      logger.error('[Ngrok] send 發生錯誤: ' + e);
      return false;
    }
  }
};
