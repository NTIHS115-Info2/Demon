// 引入策略集合，包含預設的 local 策略
const strategies = require('./strategies');
const Logger = require('../../utils/logger');
const logger = new Logger('ASR');

let strategy = null;
let mode = 'local';


module.exports = {
  // 優先度將於 updateStrategy 時由所選策略設定
  priority: 0,
  /**
   * 更新策略模式
   * @param {'local'|'remote'|'server'} newMode
   */
  async updateStrategy(newMode = 'local') {
    logger.info('ASR 插件策略更新中...');
    mode = newMode;
    switch (newMode) {
      case 'remote':
        strategy = strategies.remote;
        break;
      case 'server':
        strategy = strategies.server;
        break;
      default:
        strategy = strategies.local;
    }
    // 依據所選策略設定優先度
    this.priority = strategy.priority;
    logger.info(`ASR 插件策略已切換為 ${mode}`);
  },

  // 啟動 ASR
  async online(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.online(options);
    } catch (e) {
      logger.error('[ASR] online 發生錯誤: ' + e);
      throw e;
    }
  },

  // 關閉 ASR
  async offline() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.offline();
    } catch (e) {
      logger.error('[ASR] offline 發生錯誤: ' + e);
      throw e;
    }
  },

  // 重啟 ASR
  async restart(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.restart(options);
    } catch (e) {
      logger.error('[ASR] restart 發生錯誤: ' + e);
      throw e;
    }
  },

  // 取得狀態
  async state() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('[ASR] state 查詢錯誤: ' + e);
      return -1;
    }
  },

  // 選用函式，目前策略未提供
  async send(data) {
    if (!strategy) await this.updateStrategy(mode);
    if (typeof strategy.send !== 'function') {
      return false;
    }
    return strategy.send(data);
  }
};
