const fs = require('fs');
const path = require('path');
const Logger = require('../../../../utils/logger');

// 建立 logger，輸出至 toolReferenceLocal.log
const logger = new Logger('toolReferenceLocal.log');

// 儲存所有工具描述，避免重複讀檔
let descriptionCache = null;
let isOnline = false;

// 此策略的啟動優先度
const priority = 50;

/**
 * 讀取 plugins 目錄下各插件的 tool-description.json
 * @param {string} rootPath 插件根目錄
 * @returns {object}
 */
function readDescriptions(rootPath) {
  const result = {};
  let dirs;
  try {
    dirs = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (e) {
    logger.error('讀取插件列表失敗: ' + e.message);
    return result;
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(rootPath, dir.name, 'tool-description.json');
    if (!fs.existsSync(file)) continue;
    try {
      const data = fs.readFileSync(file, 'utf8');
      result[dir.name] = JSON.parse(data);
    } catch (e) {
      logger.warn(`讀取 ${dir.name} 工具描述失敗: ${e.message}`);
    }
  }
  return result;
}

module.exports = {
  priority,
  async updateStrategy() {},

  // 啟動策略：載入所有工具描述
  async online() {
    try {
      const pluginsPath = path.resolve(__dirname, '../../..');
      descriptionCache = readDescriptions(pluginsPath);
      isOnline = true;
      logger.info('ToolReference local 策略已啟動');
    } catch (e) {
      logger.error('啟動失敗: ' + e.message);
      throw e;
    }
  },

  async offline() {
    descriptionCache = null;
    isOnline = false;
  },

  async restart(options) {
    await this.offline();
    return this.online(options);
  },

  async state() {
    return isOnline ? 1 : 0;
  },

  /**
   * 傳回工具描述清單
   * @returns {object}
   */
  async send() {
    if (!descriptionCache) {
      const pluginsPath = path.resolve(__dirname, '../../..');
      descriptionCache = readDescriptions(pluginsPath);
    }
    return descriptionCache;
  }
};
