// 取得策略集合
const strategies = require('./strategies');
const Logger = require('../../utils/logger');
const logger = new Logger('TTS');

let strategy = null;


module.exports = {
  // 優先度將在 updateStrategy 中設定
  priority: 0,
  // 更新策略
  async updateStrategy() {
    logger.info('TTS 插件策略更新中...');
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info('TTS 插件策略已載入');
  },

  // 啟動 TTS
  async online(options) {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.online(options);
    } catch (e) {
      logger.error('[TTS] online 發生錯誤: ' + e);
      throw e;
    }
  },

  // 關閉 TTS
  async offline() {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.offline();
    } catch (e) {
      logger.error('[TTS] offline 發生錯誤: ' + e);
      throw e;
    }
  },

  // 重啟 TTS
  async restart(options) {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.restart(options);
    } catch (e) {
      logger.error('[TTS] restart 發生錯誤: ' + e);
      throw e;
    }
  },

  // 查詢狀態
  async state() {
    if (!strategy) await this.updateStrategy();
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('[TTS] state 查詢錯誤: ' + e);
      return -1;
    }
  },

  // 選用函式
  async send(data) {
    if (!strategy || typeof strategy.send !== 'function') {
      return false;
    }
    return strategy.send(data);
  }
};
