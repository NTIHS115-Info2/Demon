const fs = require("fs");
const path = require("path");

// 內部引用
const logger = require("../utils/logger");

const Logger = new logger("pluginsManager.log");

/**
 * 插件管理器類別，負責處理插件的載入、啟動、關閉和重啟等生命週期
 */
class PluginsManager {
  /**
   * 建立插件管理器實例
   * @param {string} rootPath - 插件根目錄的路徑
   */
  constructor() {
    // 使用相對於當前檔案位置的 plugins 目錄，避免硬編碼絕對路徑
    this.rootPath = path.resolve(__dirname, '..', 'plugins');
    this.plugins = new Map();          // 儲存已載入的插件
    this.queue = [];                   // 插件啟動佇列
    this.running = false;              // 佇列處理狀態
    this.maxConcurrent = 1;            // 每次僅啟動一個插件
  }

  // 統一處理插件名稱小寫
  normalizeName(name) {
    return typeof name === "string" ? name.toLowerCase() : name;
  }

  /**
   * 載入指定名稱的插件
   * @param {string} name - 插件名稱
   * @throws {Error} 當找不到插件的 setting.js 檔案時拋出錯誤
   */
  async loadPlugin(name) {
    const pluginPath = path.join(this.rootPath, name, "index.js");
    if (fs.existsSync(pluginPath)) {
      const plugin = require(pluginPath);
      plugin.updateStrategy();  // 確保策略已更新
      this.plugins.set(this.normalizeName(name), plugin); // 這裡改為小寫
      Logger.info(`[PluginManager] 載入插件 ${name}`);
    } else {
      throw new Error(`無法找到 ${name} 插件的 setting.js`);
    }
  }

    /**
   * 傳送資料給指定插件
   * @param {string} name - 插件名稱
   * @param {any} data - 傳送的資料內容
   * @returns {Promise<resolve> || true} 反傳回的內容 或是 true
   */
  async send(name, data) {
    const id = this.normalizeName(name);
    const plugin = this.plugins.get(id);
    if (!plugin) {
      Logger.warn(`[PluginManager] 插件 ${id} 尚未載入，無法傳送資料`);
      return false;
    }

    if (typeof plugin.send === "function") {
      try {
        const resolve = plugin.send(data);
        Logger.info(`[PluginManager] 傳送資料給插件 ${id} 成功：${JSON.stringify(data)}`);
        return resolve || true; // 如果 send 方法沒有返回值，則返回 true
      } catch (err) {
        Logger.error(`[PluginManager] 傳送資料給插件 ${id} 失敗：${err.message}`);
        return false;
      }
    } else {
      Logger.warn(`[PluginManager] 插件 ${id} 未實作 send(data)，忽略傳送`);
      return false;
    }
  }


  /**
   * 將插件加入啟動佇列
   * @param {string} name - 插件名稱
   * @param {Object} options - 啟動選項
   * @returns {Promise<void>}
   */
  async queueOnline(name, options = {}) {
    const id = this.normalizeName(name);
    const plugin = this.plugins.get(id);
    if (!plugin?.online) return false;

    // 用 Promise 包一層「包進 queue 後會觸發執行」的邏輯
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        Logger.info(`[Queue] 開始啟動插件：${id}`);
        try {
          await plugin.online(options);  // 這裡的 online 是真實啟動流程
          Logger.info(`[Queue] 插件 ${id} 啟動完成`);
          resolve(true); // 👈 當 queue 執行這件事完畢，才 resolve
        } catch (err) {
          Logger.error(`[Queue] 啟動插件 ${id} 失敗：${err.message}`);
          reject(err);
        }
      });

      if (!this.running) {
        this.running = true;
        this.processQueue().then(() => {
          this.running = false;
        });
      }
    });
  }




  /**
   * 處理啟動佇列中的任務
   * @private
   * @returns {Promise<void>}
   */
  async processQueue() {
    while (this.queue.length > 0) {
      const tasks = this.queue.splice(0, this.maxConcurrent);
      await Promise.all(tasks.map(fn => fn()));
      await new Promise((r) => setTimeout(r, 300)); // 啟動間隔（ms）
    }
  }

  /**
   * 將所有插件加入啟動佇列
   * @param {Object} options - 啟動選項
   * @returns {Promise<void>}
   */
  async queueAllOnline(options = {}) {
    for (const name of this.plugins.keys()) {
      await this.queueOnline(name, options);
    }
  }

  /**
   * 關閉所有已啟動的插件
   */
  async offlineAll() {
    for (const plugin of this.plugins.values()) {
      if (plugin.offline) await plugin.offline();
    }
  }

  /**
   * 重新啟動所有插件
   * @param {Object} options - 重啟選項
   */
  async restartAll(options = {}) {
    for (const plugin of this.plugins.values()) {
      if (plugin.restart) await plugin.restart(options);
    }
  }

  /**
   * 獲取指定插件的狀態
   * @param {string} name - 插件名稱
   * @returns {number} 插件狀態（1: 啟動中, 0: 關閉中）
   */
  async getPluginState(name) {
    const id = this.normalizeName(name);
    const plugin = this.plugins.get(id);
    if (plugin?.state) {
      return await plugin.state();
    }
    return -2;
  }
}

module.exports = new PluginsManager();