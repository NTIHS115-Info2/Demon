// === 段落說明：引入策略集合與記錄器以符合插件規範 ===
const strategies = require('./strategies');
const Logger = require('../../utils/logger');

// === 段落說明：初始化插件層級記錄器 ===
const logger = new Logger('calendarSystem');

// === 段落說明：維護目前策略、模式與啟動優先度 ===
let strategy = null;
let mode = 'local';

module.exports = {
  

  // === 段落說明：切換策略模式，目前僅支援 local ===
  async updateStrategy(newMode = 'local', options = {}) {
    logger.info('calendarSystem 插件準備更新策略');
    if (newMode !== 'local') {
      logger.warn(`calendarSystem 僅支援 local 策略，已自動切換為 local`);
      newMode = 'local';
    }

    strategy = strategies.local;
    mode = 'local';
    priority = strategy.priority || 0;
    this.priority = priority;

    if (strategy && typeof strategy.configure === 'function') {
      try {
        strategy.configure(options);
      } catch (err) {
        logger.error(`calendarSystem 策略配置失敗：${err.message}`);
        throw err;
      }
    }

    logger.info(`calendarSystem 已設定為 ${mode} 策略`);
  },

  // === 段落說明：啟動插件並交由當前策略處理 ===
  async online(options = {}) {
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) {
      await this.updateStrategy(useMode, options);
    } else if (typeof strategy.configure === 'function') {
      strategy.configure(options);
    }

    try {
      await strategy.online(options);
      logger.info('calendarSystem 插件已成功上線');
    } catch (err) {
      logger.error(`calendarSystem 上線失敗：${err.message}`);
      throw err;
    }
  },

  // === 段落說明：關閉插件並釋放策略資源 ===
  async offline() {
    if (!strategy) {
      logger.warn('calendarSystem 尚未初始化策略，略過離線流程');
      return;
    }

    try {
      await strategy.offline();
      logger.info('calendarSystem 插件已離線');
    } catch (err) {
      logger.error(`calendarSystem 離線失敗：${err.message}`);
      throw err;
    }
  },

  // === 段落說明：重新啟動插件以套用最新設定 ===
  async restart(options = {}) {
    if (!strategies){
      logger.warn('calendarSystem 尚未初始化策略，略過重啟流程');
      return;
    }
    try{
      await strategy.restart();
    }catch (err) {
      logger.error(`calenderSystem 重啟失敗 : ${err}`);
      throw err;
    }
  },

  // === 段落說明：查詢目前插件狀態 ===
  async state() {
    if (!strategy) {
      logger.warn('calendarSystem 尚未初始化策略，回傳離線狀態');
      return -1;
    }

    try {
      return await strategy.state();
    } catch (err) {
      logger.error(`calendarSystem 取得狀態失敗：${err.message}`);
      return -1;
    }
  },

  // === 段落說明：統一處理指令並委派給策略 ===
  async send(data = {}) {
    if (!strategy) {
      throw new Error('calendarSystem 尚未初始化策略');
    }

    try {
      return await strategy.send(data);
    } catch (err) {
      logger.error(`calendarSystem 指令處理失敗：${err.message}`);
      throw err;
    }
  },
};
