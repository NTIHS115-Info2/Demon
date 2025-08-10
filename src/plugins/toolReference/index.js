const strategies = require('./strategies');
const Logger = require('../../utils/logger');

const logger = new Logger('toolReference');
let strategy = null;
let mode = 'local';

module.exports = {
  pluginName: 'toolReference',
  pluginType: 'LLM',
  priority: 0,

  /**
   * 更新策略，目前僅支援 local
   * @param {'local'} newMode
   */
  async updateStrategy(newMode = 'local') {
    logger.info('toolReference 插件策略更新中...');
    mode = newMode;
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info(`toolReference 使用 ${mode} 策略`);
  },

  async online(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.online(options);
    } catch (e) {
      logger.error('[toolReference] online 發生錯誤: ' + e.message);
      throw e;
    }
  },

  async offline() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.offline();
    } catch (e) {
      logger.error('[toolReference] offline 發生錯誤: ' + e.message);
      throw e;
    }
  },

  async restart(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.restart(options);
    } catch (e) {
      logger.error('[toolReference] restart 發生錯誤: ' + e.message);
      throw e;
    }
  },

  async state() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('[toolReference] state 查詢錯誤: ' + e.message);
      return -1;
    }
  },

  async send(data) {
    if (!strategy) await this.updateStrategy(mode);
    if (typeof strategy.send !== 'function') return false;
    try {
      return await strategy.send(data);
    } catch (e) {
      logger.error('[toolReference] send 執行錯誤: ' + e.message);
      return false;
    }
  },
};
