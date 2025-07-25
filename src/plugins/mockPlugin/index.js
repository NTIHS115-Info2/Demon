const Logger = require('../../utils/logger');
const logger = new Logger('MockPlugin');

let onlineState = 0;

module.exports = {
  pluginName: 'mock',
  pluginType: 'TOOL',
  priority: 0,
  async updateStrategy() {
    // 此插件僅提供單一策略，故無需處理
    logger.info('MockPlugin 策略初始化');
  },
  async online() {
    onlineState = 1;
    logger.info('MockPlugin 已上線');
  },
  async offline() {
    onlineState = 0;
    logger.info('MockPlugin 已離線');
  },
  async restart() {
    await this.offline();
    await this.online();
  },
  async state() {
    return onlineState;
  },
  /**
   * 接收字串並依模式轉換
   * @param {{text:string, mode?:'success'|'fail'|'timeout'}} param0
   */
  async send({ text, mode = 'success' } = {}) {
    if (mode === 'fail') {
      throw new Error('MockPlugin 模擬失敗');
    }
    if (mode === 'timeout') {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!text) return '';
    return String(text).toUpperCase();
  },
  // 提供工具描述
  metadata: require('./tool-description.json')
};
