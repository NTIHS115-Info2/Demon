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
    // 插件容器，key 為插件名稱，value 為插件實例
    this.plugins = new Map();           // 已載入的插件
    this.llmPlugins = new Map();        // 額外紀錄 LLM 類型插件方便查詢
    this.queue = [];                   // 插件啟動佇列
    this.running = false;              // 佇列處理狀態
    this.maxConcurrent = 1;            // 每次僅啟動一個插件
    this.queuedPlugins = new Set();    // 追蹤目前在佇列中的插件，防止重複加入
    this.exceptionLLM = new Set();     // LLM 插件啟動例外清單
  }

  // 統一處理插件名稱小寫
  normalizeName(name) {
    return typeof name === "string" ? name.toLowerCase() : name;
  }

  // 審查插件是否具有必要函數
  requestReview(plugin){
    const requiredMethods = ['online', 'offline', 'restart', 'state' , 'updateStrategy'];
    for (const method of requiredMethods) {
      if (typeof plugin[method] !== 'function') {
        throw new Error(`插件 ${plugin.pluginName} 缺少必要方法：${method}`);
      }
    }
    return true; // 如果所有方法都存在，則返回 true
  }

  /**
   * 載入指定名稱的插件
   * @param {string} name - 插件名稱
   * @param {string} mode - 插件啟動模式（預設為 'auto'）
   * @throws {Error} 當找不到插件的 index.js 檔案時拋出錯誤
   */
  async loadPlugin(name , mode = 'auto') {
    const pluginPath = path.join(this.rootPath, name, "index.js");
    if (fs.existsSync(pluginPath)) {
      const plugin = require(pluginPath);

      if (!this.requestReview(plugin)) {
        throw new Error(`插件 ${name} 不符合要求，請檢查其實作`);
      }

      // 若插件未定義 priority 則給予預設值 0
      if (typeof plugin.priority !== 'number') plugin.priority = 0;

      if (typeof plugin.updateStrategy === 'function') {
        plugin.updateStrategy(mode);  // 確保策略已更新
      }
      const id = this.normalizeName(name);
      this.plugins.set(id, plugin); // 儲存插件
      if (plugin.pluginType === 'LLM') {
        this.llmPlugins.set(id, plugin);
      }
      Logger.info(`[PluginManager] 載入插件 ${name}`);
    } else {
      throw new Error(`無法找到 ${name} 插件的 index.js`);
    }
  }

  /**
   * 載入所有插件
   * @returns {Promise<void>}
   */
  async loadAllPlugins() {

    Logger.info("正在嘗試載入所有插件");

    const pluginDirs = fs.readdirSync(this.rootPath).filter(dir => {
      return fs.statSync(path.join(this.rootPath, dir)).isDirectory();
    });

    for (const dir of pluginDirs) {
      try {
        await this.loadPlugin(dir);
      } catch (err) {
        Logger.error(`[PluginManager] 載入插件 ${dir} 失敗：${err.message}`);
      }

      if(this.getPluginState(dir)) Logger.info(`${dir} v`)
      else Logger.info(`${dir} x`)

    }

    Logger.info("所有插件載入成功");
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

    if (await plugin.state() == 0) {
      Logger.warn(`[PluginManager] 插件 ${id} 當前狀態為離線，無法傳送資料`);
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

    // 原子檢查：檢查是否已在佇列中或已上線，防止重複加入
    if (this.queuedPlugins.has(id)) {
      Logger.warn(`[Queue] 插件 ${id} 已在佇列中，忽略重複加入`);
      return false;
    }

    // 立即標記為正在處理，防止併發問題
    this.queuedPlugins.add(id);

    try {
      // 檢查插件狀態，避免重複啟動
      const state = await this.getPluginState(id);
      if (state === 1) {
        Logger.warn(`[Queue] 插件 ${id} 已在線上，忽略重複啟動`);
        this.queuedPlugins.delete(id); // 移除標記
        return false;
      }
    } catch (err) {
      Logger.error(`[Queue] 取得插件 ${id} 狀態失敗：${err.message}`);
      this.queuedPlugins.delete(id); // 移除標記
      return false;
    }

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
        } finally {
          // 從佇列中移除標記
          this.queuedPlugins.delete(id);
        }
      });

      if (!this.running) {
        this.running = true;
        this.processQueue().then(() => {
          this.running = false;
        }).catch(err => {
          Logger.error(`[Queue] 處理佇列時發生錯誤：${err.message}`);
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
    // 依照 priority 由高至低排序，數值相同保持載入順序
    const arr = Array.from(this.plugins.entries());
    arr.sort((a, b) => (b[1].priority || 0) - (a[1].priority || 0));
    for (const [name] of arr) {
      await this.queueOnline(name, options);
    }
  }

  /**
   * 啟動指定插件
   * @param {string} name - 插件名稱
   * @returns {Promise<boolean>} 成功返回 true，失敗返回 false
   */
  async offline(name) {
    const id = this.normalizeName(name);
    const plugin = this.plugins.get(id);
    if (!plugin?.offline) {
      Logger.warn(`[PluginManager] 插件 ${id} 尚未載入或不支援離線`);
      return false;
    }

    if (await plugin.state() === 0) {
      Logger.warn(`[PluginManager] 插件 ${id} 已經處於離線狀態`);
      return true; // 已經離線，無需再次關閉
    }

    try {
      await plugin.offline();
      Logger.info(`[PluginManager] 成功關閉插件：${id}`);
      return true;
    } catch (err) {
      Logger.error(`[PluginManager] 關閉插件 ${id} 失敗：${err.message}`);
      return false;
    }
  }

  /**
   * 關閉所有已啟動的插件
   */
  async offlineAll() {
    for (const [name, plugin] of this.plugins.entries()) {
      try {
        if (plugin.offline) {
          await plugin.offline();
          Logger.info(`[PluginManager] 成功關閉插件：${name}`);
        }
      } catch (err) {
        Logger.error(`[PluginManager] 關閉插件 ${name} 失敗：${err.message}`);
        // 繼續處理其他插件，不拋出例外
      }
    }
  }

  /**
   * 重新啟動所有插件
   * @param {Object} options - 重啟選項
   */
  async restartAll(options = {}) {
    for (const [name, plugin] of this.plugins.entries()) {
      try {
        if (plugin.restart) {
          await plugin.restart(options);
          Logger.info(`[PluginManager] 成功重啟插件：${name}`);
        }
      } catch (err) {
        Logger.error(`[PluginManager] 重啟插件 ${name} 失敗：${err.message}`);
        // 繼續處理其他插件，不拋出例外
      }
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

  /**
   * 載入所有LLM插件
   */
  loadAllLLMPlugins() {
    Logger.info("正在嘗試載入所有 LLM 插件");
    const pluginDirs = fs.readdirSync(this.rootPath).filter(dir => {
      return fs.statSync(path.join(this.rootPath, dir)).isDirectory();
    });

    for (const dir of pluginDirs) {
      try {
        const pluginPath = path.join(this.rootPath, dir, "index.js");
        if (fs.existsSync(pluginPath)) {
          const plugin = require(pluginPath);
          if (plugin.pluginType === 'LLM') {
            if (!this.requestReview(plugin)) {
              throw new Error(`插件 ${dir} 不符合要求，請檢查其實作`);
            }
            // 若插件未定義 priority 則給予預設值 0
            if (typeof plugin.priority !== 'number') plugin.priority = 0;
            if (typeof plugin.updateStrategy === 'function') {
              plugin.updateStrategy('auto');  // 確保策略已更新
            }
            const id = this.normalizeName(dir);
            this.plugins.set(id, plugin); // 儲存插件
            this.llmPlugins.set(id, plugin);
            Logger.info(`[PluginManager] 載入 LLM 插件 ${dir}`);
          } else {
            Logger.info(`[PluginManager] 插件 ${dir} 非 LLM 類型，跳過`);
          } 
        }
      } catch (err) {
        Logger.error(`[PluginManager] 載入插件 ${dir} 失敗：${err.message}`);
      }
    }
  } 

  /**
   * 取得指定名稱的 LLM 插件
   * @param {string} name
   * @returns {object|null}
   */
  getLLMPlugin(name) {
    const id = this.normalizeName(name);
    return this.llmPlugins.get(id) || null;
  }

  /**
   * 取得所有已註冊的 LLM 插件清單
   * @returns {Array<object>}
   */
  getAllLLMPlugin() {
    return Array.from(this.llmPlugins.values());
  }

  /**
   * 設定 LLM 插件啟動例外清單
   * @param {Array<string>} list - 要排除啟動的插件名稱陣列
   * @returns {boolean} 是否成功設定
   */
  SetExceptionLLMTool(list = []) {
    try {
      if (!Array.isArray(list)) {
        throw new Error("傳入參數必須為陣列");
      }

      // 正規化名稱後存入 Set
      this.exceptionLLM = new Set(
        list.map(name => this.normalizeName(name))
      );

      Logger.info(
        `[StartLLMTool] 已設定例外插件清單: ${Array.from(this.exceptionLLM).join(', ') || '無'}`
      );
      return true;
    } catch (err) {
      Logger.error(`[StartLLMTool] 設定例外清單失敗：${err.message}`);
      return false;
    }
  }

  /**
   * 啟動所有非例外清單中的 LLM 插件
   * @param {Object} options - 傳遞給插件的啟動選項
   * @returns {Promise<{started:string[], skipped:string[]}>>}
   */
  async StartLLMTool(options = {}) {
    const result = { started: [], skipped: [] };

    // 確保已載入所有 LLM 插件
    this.loadAllLLMPlugins();
    

    const list = this.getAllLLMPlugin();
    if (!Array.isArray(list)) {
      Logger.error('[StartLLMTool] getAllLLMPlugin 回傳非陣列');
      return result;
    }

    // 進行型別守衛，確保必要欄位存在
    const plugins = list.filter(p =>
      p && typeof p === 'object' &&
      typeof p.pluginName === 'string' &&
      typeof p.online === 'function'
    );

    // 依 priority 排序，高優先度優先啟動
    plugins.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const plugin of plugins) {
      const name = this.normalizeName(plugin.pluginName);

      if (this.exceptionLLM.has(name)) {
        Logger.info(`[StartLLMTool] 插件 ${name} 在例外清單中，跳過啟動`);
        result.skipped.push(name);
        continue;
      }

      try {
        await this.queueOnline(name, options);
        Logger.info(`[StartLLMTool] 插件 ${name} 啟動完成`);
        result.started.push(name);
      } catch (err) {
        Logger.error(`[StartLLMTool] 插件 ${name} 啟動失敗：${err.message}`);
      }
    }

    return result;
  }

  /**
   * 查詢插件的 metadata 資訊
   * @param {string} name
   * @returns {any}
   */
  getPluginMetadata(name) {
    const id = this.normalizeName(name);
    return this.plugins.get(id)?.metadata || null;
  }
}

module.exports = new PluginsManager();
