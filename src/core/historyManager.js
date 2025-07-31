const fs = require('fs');
const path = require('path');

const fileEditer = require('../tools/fileEditer');
const Logger = require('../utils/logger');
const configManager = require('../utils/configManager');

const logger = new Logger('historyManager.log');

// 歷史管理器設定檔綱要
const HISTORY_CONFIG_SCHEMA = {
  types: {
    maxMessages: 'number',
    expireDays: 'number',
    backupCount: 'number',
    maxFileSize: 'number'
  },
  ranges: {
    maxMessages: { min: 10, max: 1000 },
    expireDays: { min: 1, max: 365 },
    backupCount: { min: 0, max: 10 },
    maxFileSize: { min: 1024, max: 10485760 } // 1KB to 10MB
  }
};

// 預設設定
const DEFAULT_CONFIG = {
  maxMessages: 100,
  expireDays: 7,
  backupCount: 3,
  maxFileSize: 1048576 // 1MB
};

/**
 * 對話歷史管理器
 * 依照使用者 ID 儲存與讀取對話紀錄，支援自動裁剪與備份
 */
class HistoryManager {
  constructor(historyDir = path.resolve(__dirname, '..', '..', 'history')) {
    this.historyDir = historyDir;
    this.cache = new Map();
    
    // 載入設定檔（使用預設值如果載入失敗）
    this.config = this.loadConfig();
    
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
    
    // 轉換設定為毫秒
    this.expireMs = this.config.expireDays * 24 * 60 * 60 * 1000;
  }

  /**
   * 載入歷史管理器設定
   * @private
   */
  loadConfig() {
    try {
      const configPath = path.resolve(__dirname, '..', '..', 'config', 'history.js');
      if (fs.existsSync(configPath)) {
        return configManager.loadAndValidate(configPath, HISTORY_CONFIG_SCHEMA, 'HistoryManager');
      }
    } catch (error) {
      logger.warn(`無法載入歷史管理器設定檔，使用預設值: ${error.message}`);
    }
    return DEFAULT_CONFIG;
  }

  /**
   * 取得指定使用者的歷史陣列
   * @private
   */
  async _load(userId) {
    if (this.cache.has(userId)) return this.cache.get(userId);
    const file = path.join(this.historyDir, `${userId}.json`);
    try {
      const exists = await fileEditer.checkFile(file).catch(() => false);
      if (!exists) {
        this.cache.set(userId, []);
        return [];
      }
      const text = await fileEditer.GetFileContent(file);
      const arr = JSON.parse(text || '[]');
      this.cache.set(userId, arr);
      return arr;
    } catch (err) {
      logger.error(`讀取歷史檔案失敗: ${err.message}`);
      this.cache.set(userId, []);
      return [];
    }
  }

  /**
   * 儲存指定使用者的歷史紀錄，包含備份管理
   * @private
   */
  async _save(userId) {
    const file = path.join(this.historyDir, `${userId}.json`);
    const arr = this.cache.get(userId) || [];
    
    try {
      // 檢查檔案大小，如需要則進行備份
      await this._rotateIfNeeded(file);
      
      const content = JSON.stringify(arr, null, 2);
      await fileEditer.writeFile_Cover(file, content);
    } catch (err) {
      logger.error(`寫入歷史檔案失敗: ${err.message}`);
    }
  }

  /**
   * 檔案輪轉備份
   * @private
   */
  async _rotateIfNeeded(file) {
    try {
      if (!fs.existsSync(file)) return;
      
      const stats = fs.statSync(file);
      if (stats.size < this.config.maxFileSize) return;
      
      // 進行檔案輪轉
      const backupCount = this.config.backupCount;
      if (backupCount > 0) {
        // 移動舊備份檔案
        for (let i = backupCount; i > 1; i--) {
          const oldBackup = `${file}.${i - 1}`;
          const newBackup = `${file}.${i}`;
          if (fs.existsSync(oldBackup)) {
            fs.renameSync(oldBackup, newBackup);
          }
        }
        
        // 創建新備份
        if (backupCount >= 1) {
          fs.renameSync(file, `${file}.1`);
        }
        
        logger.info(`歷史檔案備份完成: ${file}`);
      }
    } catch (err) {
      logger.error(`檔案輪轉失敗: ${err.message}`);
    }
  }

  /**
   * 裁剪過期或超量的歷史
   * @private
   */
  _prune(userId) {
    const arr = this.cache.get(userId) || [];
    const now = Date.now();
    
    // 移除過期訊息
    const filtered = arr.filter(m => now - m.timestamp <= this.expireMs);
    
    // 限制訊息數量
    const result = filtered.slice(-this.config.maxMessages);
    
    // 記錄裁剪統計
    const removedCount = arr.length - result.length;
    if (removedCount > 0) {
      logger.info(`[${userId}] 裁剪了 ${removedCount} 條歷史訊息`);
    }
    
    this.cache.set(userId, result);
  }

  /**
   * 新增一則歷史訊息
   * @param {string} userId 使用者識別
   * @param {'user'|'assistant'|'system'} role 角色
   * @param {string} content 內容
   */
  async appendMessage(userId, role, content) {
    if (!userId) throw new Error('userId 不可為空');
    const arr = await this._load(userId);
    arr.push({ role, content, timestamp: Date.now() });
    this._prune(userId);
    await this._save(userId);
    logger.info(`[append] ${userId} ${role}`);
  }

  /**
   * 取得歷史紀錄
   * @param {string} userId 使用者識別
   * @param {number} limit 限制筆數
   * @returns {Promise<Array<{role:string,content:string,timestamp:number}>>}
   */
  async getHistory(userId, limit = null) {
    await this._load(userId);
    this._prune(userId);
    await this._save(userId);
    const arr = this.cache.get(userId) || [];
    if (!limit || limit <= 0) return arr;
    const start = Math.max(0, arr.length - limit);
    return arr.slice(start);
  }

  /**
   * 清除指定使用者的所有歷史
   * @param {string} userId
   */
  async clearHistory(userId) {
    if (!userId) throw new Error('userId 不可為空');
    
    // 清除緩存
    this.cache.set(userId, []);
    
    // 刪除實體檔案
    const file = path.join(this.historyDir, `${userId}.json`);
    try {
      await fs.promises.unlink(file);
      logger.info(`[clearHistory] 已刪除檔案: ${file}`);
    } catch (err) {
      // 檔案不存在或刪除失敗時警告但不中斷服務
      if (err.code !== 'ENOENT') {
        logger.error(`刪除歷史檔案失敗: ${err.message}`);
      }
    }
  }

  /**
   * 獲取歷史管理器統計資訊
   * @returns {object} 統計資訊
   */
  async getStats() {
    const stats = {
      config: this.config,
      cacheSize: this.cache.size,
      historyFiles: [],
      totalSize: 0
    };

    try {
      const files = fs.readdirSync(this.historyDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.historyDir, file);
          const stat = fs.statSync(filePath);
          stats.historyFiles.push({
            name: file,
            size: stat.size,
            modified: stat.mtime
          });
          stats.totalSize += stat.size;
        }
      }
    } catch (err) {
      logger.error(`獲取統計資訊失敗: ${err.message}`);
    }

    return stats;
  }

  /**
   * 清理過期備份檔案
   */
  async cleanupBackups() {
    try {
      const files = fs.readdirSync(this.historyDir);
      const now = Date.now();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 天
      
      let cleaned = 0;
      for (const file of files) {
        // 只處理備份檔案（.json.1, .json.2 等）
        if (/\.json\.\d+$/.test(file)) {
          const filePath = path.join(this.historyDir, file);
          const stat = fs.statSync(filePath);
          
          if (now - stat.mtime.getTime() > maxAge) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        }
      }
      
      if (cleaned > 0) {
        logger.info(`清理了 ${cleaned} 個過期備份檔案`);
      }
    } catch (err) {
      logger.error(`清理備份檔案失敗: ${err.message}`);
    }
  }
}

module.exports = new HistoryManager();
