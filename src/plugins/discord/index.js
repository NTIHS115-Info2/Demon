// 引入策略模組，初期僅提供 local 策略
const strategies = require('./strategies');
const Logger = require('../../utils/logger');
const logger = new Logger('DISCORD');

let strategy = null;
let mode = 'local';

module.exports = {
  // 優先度將在 updateStrategy 時由所選策略設定
  priority: 0,
  /**
   * 更新策略模式，目前僅支援 local
   * @param {'local'} newMode
   */
  async updateStrategy(newMode = 'local') {
    logger.info('Discord 插件策略更新中...');
    mode = newMode;
    strategy = strategies.local;
    // 依策略設定優先度
    this.priority = strategy.priority;
    logger.info('Discord 插件策略已載入');
  },

  async online(options) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.online(options);
    } catch (e) {
      logger.error('[DISCORD] online 發生錯誤: ' + e);
      throw e;
    }
  },

  async offline() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.offline();
    } catch (e) {
      logger.error('[DISCORD] offline 發生錯誤: ' + e);
      throw e;
    }
  },

  async restart(options) {
    const useMode = options?.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode);
    try {
      return await strategy.restart(options);
    } catch (e) {
      logger.error('[DISCORD] restart 發生錯誤: ' + e);
      throw e;
    }
  },

  async state() {
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('[DISCORD] state 查詢錯誤: ' + e);
      return -1;
    }
  },

  // 將外部傳入的指令分派至內部對應函式
  async send(data = {}) {
    if (!strategy) await this.updateStrategy(mode);
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
