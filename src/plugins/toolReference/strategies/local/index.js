const fs = require('fs');
const path = require('path');
const Logger = require('../../../../utils/logger');

// 建立 logger，輸出至 toolReferenceLocal.log
const logger = new Logger('toolReferenceLocal.log');

// 儲存所有工具描述，避免重複讀檔
let descriptionCache = null;
let isOnline = false;
let watcher = null;

// 此策略的啟動優先度
const priority = 50;

/**
 * 設置檔案監控，當 tool-description.json 檔案變更時自動重新載入
 * @param {string} rootPath 插件根目錄
 */
function setupFileWatcher(rootPath) {
  if (watcher) {
    watcher.close();
    watcher = null;
  }

  try {
    // 監控整個 plugins 目錄的變化
    watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      
      // 只監控 tool-description.json 檔案的變化
      if (filename.endsWith('tool-description.json')) {
        logger.info(`檢測到工具描述檔案變更: ${filename}`);
        // 延遲重新載入，避免檔案寫入過程中讀取
        setTimeout(() => {
          descriptionCache = readDescriptions(rootPath);
          logger.info('工具描述快取已重新載入');
        }, 100);
      }
      // 監控插件目錄的新增/刪除
      else if (eventType === 'rename') {
        const parts = filename.split(path.sep);
        if (parts.length === 1) { // 頂層目錄變化
          logger.info(`檢測到插件目錄變更: ${filename}`);
          setTimeout(() => {
            descriptionCache = readDescriptions(rootPath);
            logger.info('工具描述快取已重新載入');
          }, 100);
        }
      }
    });
    
    logger.info('檔案監控已啟動');
  } catch (e) {
    logger.warn('無法啟動檔案監控: ' + e.message);
  }
}
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
    if (!fs.existsSync(file)) {
      logger.info(`插件 ${dir.name} 無工具描述檔案，跳過`);
      continue;
    }
    try {
      const data = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(data);
      
      // 基本驗證工具描述格式
      if (!parsed.name || !parsed.description) {
        logger.warn(`插件 ${dir.name} 工具描述格式不完整，缺少 name 或 description 欄位`);
        continue;
      }
      
      result[dir.name] = parsed;
      logger.info(`成功載入插件 ${dir.name} 的工具描述`);
    } catch (e) {
      logger.warn(`讀取 ${dir.name} 工具描述失敗: ${e.message}`);
    }
  }
  
  logger.info(`共載入 ${Object.keys(result).length} 個插件的工具描述`);
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
      setupFileWatcher(pluginsPath);
      isOnline = true;
      logger.info('ToolReference local 策略已啟動');
    } catch (e) {
      logger.error('啟動失敗: ' + e.message);
      throw e;
    }
  },

  async offline() {
    if (watcher) {
      watcher.close();
      watcher = null;
      logger.info('檔案監控已停止');
    }
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
  },

  /**
   * 獲取工具描述統計資訊
   * @returns {object}
   */
  async getStats() {
    const descriptions = await this.send();
    const stats = {
      totalPlugins: Object.keys(descriptions).length,
      pluginsByType: {},
      pluginNames: Object.keys(descriptions)
    };

    for (const [pluginName, desc] of Object.entries(descriptions)) {
      const type = desc.type || 'unknown';
      if (!stats.pluginsByType[type]) {
        stats.pluginsByType[type] = 0;
      }
      stats.pluginsByType[type]++;
    }

    return stats;
  }
};
