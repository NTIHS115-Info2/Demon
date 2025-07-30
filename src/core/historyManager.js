const fs = require('fs');
const path = require('path');

const fileEditer = require('../tools/fileEditer');
const Logger = require('../utils/logger');

const logger = new Logger('historyManager.log');

/**
 * 對話歷史管理器
 * 依照使用者 ID 儲存與讀取對話紀錄
 */
class HistoryManager {
  constructor(historyDir = path.resolve(__dirname, '..', '..', 'history')) {
    this.historyDir = historyDir;
    this.cache = new Map();
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
    // 歷史保留上限與過期時間
    this.maxMessages = 100;
    this.expireMs = 7 * 24 * 60 * 60 * 1000; // 7 天
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
   * 儲存指定使用者的歷史紀錄
   * @private
   */
  async _save(userId) {
    const file = path.join(this.historyDir, `${userId}.json`);
    const arr = this.cache.get(userId) || [];
    try {
      await fileEditer.writeFile_Cover(file, JSON.stringify(arr, null, 2));
    } catch (err) {
      logger.error(`寫入歷史檔案失敗: ${err.message}`);
    }
  }

  /**
   * 裁剪過期或超量的歷史
   * @private
   */
  _prune(userId) {
    const arr = this.cache.get(userId) || [];
    const now = Date.now();
    const filtered = arr.filter(m => now - m.timestamp <= this.expireMs);
    const result = filtered.slice(-this.maxMessages);
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
  async getHistory(userId, limit = 20) {
    await this._load(userId);
    this._prune(userId);
    await this._save(userId);
    const arr = this.cache.get(userId) || [];
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
}

module.exports = new HistoryManager();
