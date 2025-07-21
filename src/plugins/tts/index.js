// 取得策略集合
const axios = require('axios');
const strategies = require('./strategies');
const serverInfo = require('./strategies/server/infor');
const OsInfor = require('../../tools/OsInfor');
const Logger = require('../../utils/logger');
const logger = new Logger('TTS');

let strategy = null;
let mode = 'local';
const defaultWeights = { remote: 3, server: 2, local: 1 };
let weights = { ...defaultWeights };

module.exports = {
  // 優先度將在 updateStrategy 中設定
  priority: 0,
  /**
   * 更新策略模式
   * @param {'local'|'remote'|'server'} newMode
   */
  async updateStrategy(newMode = 'auto', options = {}) {
    logger.info('TTS 插件策略更新中...');
    weights = { ...weights, ...(options.weights || {}) };

    if (newMode !== 'auto') {
      mode = newMode;
      strategy = strategies[newMode] || strategies.local;
      this.priority = strategy.priority;
      logger.info(`TTS 插件策略已切換為 ${mode}`);
      return;
    }

    const order = Object.keys(weights).sort((a, b) => weights[b] - weights[a]);

    for (const m of order) {
      if (m === 'remote') {
        if (options.baseUrl) {
          try {
            await axios.get(options.baseUrl, { timeout: 1000 });
            mode = 'remote';
            strategy = strategies.remote;
            this.priority = strategy.priority;
            logger.info('TTS 自動選擇 remote 策略');
            return;
          } catch (e) {
            logger.warn('remote 無法連線: ' + e.message);
          }
        }
      } else if (m === 'server') {
        try {
          const info = await OsInfor.table();
          const ok = Object.entries(serverInfo.serverInfo || {}).every(([k, v]) => info[k] === v);
          if (ok) {
            mode = 'server';
            strategy = strategies.server;
            this.priority = strategy.priority;
            logger.info('TTS 自動選擇 server 策略');
            return;
          }
        } catch (e) {
          logger.warn('server 判定失敗: ' + e.message);
        }
      } else if (m === 'local') {
        mode = 'local';
        strategy = strategies.local;
        this.priority = strategy.priority;
        logger.info('TTS 自動選擇 local 策略');
        return;
      }
    }

    // fallback
    mode = 'local';
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info('TTS 自動選擇預設 local 策略');
  },

  // 啟動 TTS
  async online(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
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
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
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
