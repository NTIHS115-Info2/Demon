// 引入策略模組
const strategies = require('./strategies');
const Logger = require('../../utils/logger');
const logger = new Logger('SpeechBroker');

let strategy = null;


module.exports = {
  priority: 0,
  // 更新策略，目前僅支援 local
  async updateStrategy() {
    logger.info('SpeechBroker 策略更新中...');
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info('SpeechBroker 策略已載入');
  },

  // 啟動插件
  async online(options) {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.online(options);
    } catch (e) {
      logger.error('[SpeechBroker] online 發生錯誤: ' + e);
      throw e;
    }
  },

  // 關閉插件
  async offline() {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.offline();
    } catch (e) {
      logger.error('[SpeechBroker] offline 發生錯誤: ' + e);
      throw e;
    }
  },

  // 重啟插件
  async restart(options) {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.restart(options);
    } catch (e) {
      logger.error('[SpeechBroker] restart 發生錯誤: ' + e);
      throw e;
    }
  },

  // 查詢狀態
  async state() {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('[SpeechBroker] state 查詢錯誤: ' + e);
      return -1;
    }
  },
};
