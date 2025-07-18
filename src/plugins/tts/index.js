// 取得策略集合
const strategies = require('./strategies');
const Logger = require('../../utils/logger');
const logger = new Logger('TTS');

let strategy = null;
let mode = 'local';

module.exports = {
  // 優先度將在 updateStrategy 中設定
  priority: 0,
  /**
   * 更新策略模式
   * @param {'local'|'remote'|'server'} newMode
   */
  async updateStrategy(newMode = 'local') {
    logger.info('TTS 插件策略更新中...');
    mode = newMode;
    switch (newMode) {
      case 'remote':
        strategy = remote;
        break;
      case 'server':
        strategy = server;
        break;
      default:
        strategy = strategies.local;
    }
    this.priority = strategy.priority;
    logger.info(`TTS 插件策略已切換為 ${mode}`);
  },

  // 啟動 TTS
  async online(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.online(options);
    } catch (e) {
      logger.error('[TTS] online 發生錯誤: ' + e);
      throw e;
    }
  },

  // 關閉 TTS
  async offline() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.offline();
    } catch (e) {
      logger.error('[TTS] offline 發生錯誤: ' + e);
      throw e;
    }
  },

  // 重啟 TTS
  async restart(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.restart(options);
    } catch (e) {
      logger.error('[TTS] restart 發生錯誤: ' + e);
      throw e;
    }
  },

  // 查詢狀態
  async state() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('[TTS] state 查詢錯誤: ' + e);
      return -1;
    }
  },

  // 選用函式
  async send(data) {
    if (!strategy) await this.updateStrategy(mode);
    if (typeof strategy.send !== 'function') {
      return false;
    }
    return strategy.send(data);
  }
};
