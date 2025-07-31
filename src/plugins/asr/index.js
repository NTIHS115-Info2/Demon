// 引入策略集合，包含預設的 local 策略
const axios = require('axios');
const strategies = require('./strategies');
const serverInfo = require('./strategies/server/infor');
const OsInfor = require('../../tools/OsInfor');
const Logger = require('../../utils/logger');
const logger = new Logger('ASR');

let strategy = null;
let mode = 'local';
const defaultWeights = { remote: 3, server: 2, local: 1 };
let weights = { ...defaultWeights };


module.exports = {
  // 優先度將於 updateStrategy 時由所選策略設定
  priority: 0,
  /**
   * 更新策略模式
   * @param {'local'|'remote'|'server'} newMode
   */
  async updateStrategy(newMode = 'auto', options = {}) {
    logger.info('ASR 插件策略更新中...');
    weights = { ...weights, ...(options.weights || {}) };

    if (newMode !== 'auto') {
      mode = newMode;
      strategy = strategies[newMode] || strategies.local;
      this.priority = strategy.priority;
      logger.info(`ASR 插件策略已切換為 ${mode}`);
      return;
    }

    const order = Object.keys(weights).sort((a, b) => weights[b] - weights[a]);

    for (const m of order) {
      if (m === 'remote') {
        if (options.baseUrl) {
          try {
            await axios.get(options.baseUrl, { 
              timeout: 3000,
              headers: { 'User-Agent': 'Demon-ASR/1.0.0' }
            });
            mode = 'remote';
            strategy = strategies.remote;
            this.priority = strategy.priority;
            logger.info('ASR 自動選擇 remote 策略');
            return;
          } catch (e) {
            if (e.code === 'ECONNABORTED') {
              logger.warn('remote 連線逾時: ' + e.message);
            } else {
              logger.warn('remote 無法連線: ' + e.message);
            }
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
            logger.info('ASR 自動選擇 server 策略');
            return;
          }
        } catch (e) {
          logger.warn('server 判定失敗: ' + e.message);
        }
      } else if (m === 'local') {
        mode = 'local';
        strategy = strategies.local;
        this.priority = strategy.priority;
        logger.info('ASR 自動選擇 local 策略');
        return;
      }
    }

    mode = 'local';
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info('ASR 自動選擇預設 local 策略');
  },

  // 啟動 ASR
  async online(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
    
    const startTime = Date.now();
    try {
      logger.info(`[ASR] 啟動 ${useMode} 模式...`);
      const result = await strategy.online(options);
      const duration = Date.now() - startTime;
      logger.info(`[ASR] ${useMode} 模式啟動成功 (耗時 ${duration}ms)`);
      return result;
    } catch (e) {
      const duration = Date.now() - startTime;
      logger.error(`[ASR] ${useMode} 模式啟動失敗 (耗時 ${duration}ms): ${e.message}`);
      throw e;
    }
  },

  // 關閉 ASR
  async offline() {
    if (!strategy) await this.updateStrategy(mode);
    
    const startTime = Date.now();
    try {
      logger.info(`[ASR] 關閉 ${mode} 模式...`);
      const result = await strategy.offline();
      const duration = Date.now() - startTime;
      logger.info(`[ASR] ${mode} 模式關閉成功 (耗時 ${duration}ms)`);
      return result;
    } catch (e) {
      const duration = Date.now() - startTime;
      logger.error(`[ASR] ${mode} 模式關閉失敗 (耗時 ${duration}ms): ${e.message}`);
      throw e;
    }
  },

  // 重啟 ASR
  async restart(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
    
    const startTime = Date.now();
    try {
      logger.info(`[ASR] 重啟 ${useMode} 模式...`);
      const result = await strategy.restart(options);
      const duration = Date.now() - startTime;
      logger.info(`[ASR] ${useMode} 模式重啟成功 (耗時 ${duration}ms)`);
      return result;
    } catch (e) {
      const duration = Date.now() - startTime;
      logger.error(`[ASR] ${useMode} 模式重啟失敗 (耗時 ${duration}ms): ${e.message}`);
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
