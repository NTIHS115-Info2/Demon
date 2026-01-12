const strategies = require('./strategies');
const Logger = require('../../utils/logger');

// 建立記錄器，統一輸出 ttsArtifact 插件的狀態
const logger = new Logger('ttsArtifact');

// 初始化策略與模式，只支援 local 模式
let strategy = null;
let mode = 'local';

module.exports = {
  /**
   * 更新策略模式
   * @param {string} newMode - 目前僅支援 'local' 模式
   * @param {Object} options - 傳遞給策略的設定
   */
  async updateStrategy(newMode = 'local', options = {}) {
    // 進入策略更新流程，確保模式合法
    logger.info('ttsArtifact 插件更新策略中...');
    if (newMode !== 'local') {
      logger.warn(`不支援的模式 ${newMode}，已自動切換為 local`);
      newMode = 'local';
    }
    mode = newMode;
    strategy = strategies.local;
    this.priority = strategy.priority;
    logger.info(`ttsArtifact 已切換為 ${mode} 模式`);
  },

  /**
   * 啟動插件
   * @param {Object} options
   */
  async online(options = {}) {
    // 確保策略已初始化，避免未設定模式
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
    try {
      await strategy.online(options);
    } catch (e) {
      logger.error('ttsArtifact online 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 關閉插件
   */
  async offline() {
    // 確保策略可用再執行關閉
    if (!strategy) await this.updateStrategy(mode);
    try {
      await strategy.offline();
    } catch (e) {
      logger.error('ttsArtifact offline 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 重啟插件
   * @param {Object} options
   */
  async restart(options = {}) {
    // 確保策略同步後重啟插件
    const useMode = options.mode || mode;
    if (!strategy || useMode !== mode) await this.updateStrategy(useMode, options);
    try {
      await strategy.restart(options);
    } catch (e) {
      logger.error('ttsArtifact restart 錯誤: ' + e.message);
      throw e;
    }
  },

  /**
   * 取得插件狀態
   * @returns {Promise<number>}
   */
  async state() {
    // 先確保策略實例存在，避免空指標錯誤
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.state();
    } catch (e) {
      logger.error('ttsArtifact state 查詢錯誤: ' + e.message);
      return -1;
    }
  },

  /**
   * 傳送資料給插件並取得結果
   * @param {Object|string} data - TTS 文字內容
   * @returns {Promise<Object>}
   */
  async send(data = {}) {
    // 使用策略的 send 來觸發 artifact 建立流程
    if (!strategy) await this.updateStrategy(mode);
    try {
      return await strategy.send(data);
    } catch (e) {
      logger.error('ttsArtifact send 錯誤: ' + e.message);
      return { error: e.message };
    }
  }
};
