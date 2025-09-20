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
    // 插件設定登錄表，僅保存設定與路徑資訊
    this.pluginRegistry = new Map();
    // 無效插件紀錄表，儲存設定檔錯誤與缺失資訊
    this.invalidRegistry = new Map();
    // 目錄索引，用於將資料夾名稱對應至插件 id
    this.directoryIndex = new Map();
    // 掃描節流，避免頻繁重新掃描插件目錄
    this.lastScanTime = 0;
    this.scanCooldownMs = 3000;
    // 插件容器，key 為插件名稱，value 為插件實例
    this.plugins = new Map();           // 已載入的插件
    this.llmPlugins = new Map();        // 額外紀錄 LLM 類型插件方便查詢
    this.queue = [];                   // 插件啟動佇列
    this.running = false;              // 佇列處理狀態
    this.maxConcurrent = 1;            // 每次僅啟動一個插件
    this.queuedPlugins = new Set();    // 追蹤目前在佇列中的插件，防止重複加入
    this.exceptionLLM = new Set();     // LLM 插件啟動例外清單
  }

  /**
   * 統一處理插件名稱小寫，確保索引鍵的一致性
   * @param {string} name
   * @returns {string}
   */
  normalizeName(name) {
    return typeof name === "string" ? name.toLowerCase() : name;
  }

  // 根據插件名稱或目錄名稱解析出插件在註冊表中的唯一識別碼
  resolvePluginId(name) {
    const id = this.normalizeName(name);
    if (this.pluginRegistry.has(id)) {
      return id;
    }
    if (this.directoryIndex.has(id)) {
      return this.directoryIndex.get(id);
    }
    return null;
  }

  // 判斷是否需要重新掃描插件目錄，避免短時間內重複掃描
  shouldRescanDirectories() {
    return Date.now() - this.lastScanTime > this.scanCooldownMs;
  }

  // 讀取插件資料夾內的 setting.json，異常時拋出錯誤供外層處理
  readPluginSetting(pluginDir) {
    const settingPath = path.join(this.rootPath, pluginDir, 'setting.json');
    if (!fs.existsSync(settingPath)) {
      const error = new Error(`插件 ${pluginDir} 缺少 setting.json`);
      error.settingPath = settingPath;
      throw error;
    }

    try {
      const raw = fs.readFileSync(settingPath, 'utf-8');
      const setting = JSON.parse(raw);
      return { setting, settingPath };
    } catch (err) {
      const error = new Error(`解析 ${pluginDir}/setting.json 時發生錯誤：${err.message}`);
      error.settingPath = settingPath;
      throw error;
    }
  }

  // 驗證 setting.json 的必填欄位（name, priority）與選填欄位（pluginType）的型別與值，不符合規範時拋出錯誤
  validatePluginSetting(setting, pluginDir, settingPath) {
    if (!setting || typeof setting !== 'object' || Array.isArray(setting)) {
      throw new Error(`${pluginDir}/setting.json 格式錯誤，必須為物件`);
    }

    const { name, priority, pluginType } = setting;

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`${pluginDir}/setting.json 缺少合法的 name 欄位`);
    }

    const normalizedName = this.normalizeName(name);

    if (!Number.isSafeInteger(priority)) {
      throw new Error(`${pluginDir}/setting.json 的 priority 必須為整數`);
    }

    if (pluginType !== undefined) {
      const allowed = ['LLM', 'Tool', 'Other'];
      if (typeof pluginType !== 'string' || !allowed.includes(pluginType)) {
        throw new Error(`${pluginDir}/setting.json 的 pluginType 僅支援 ${allowed.join(', ')}`);
      }
    }

    if (this.pluginRegistry.has(normalizedName)) {
      const existed = this.pluginRegistry.get(normalizedName);
      if (existed.directory !== pluginDir) {
        throw new Error(`偵測到重複名稱的插件：${name}（已存在於目錄 ${existed.directory}）`);
      }
    }

    const indexPath = path.join(this.rootPath, pluginDir, 'index.js');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`插件 ${pluginDir} 缺少 index.js`);
    }

    return {
      id: normalizedName,
      name: name.trim(),
      priority,
      pluginType: pluginType || null,
      directory: pluginDir,
      indexPath,
      settingPath,
      setting: Object.freeze({ ...setting }),
      loaded: false,
      lastError: null,
    };
  }

  // 紀錄無效插件資訊，方便後續查詢與除錯
  recordInvalidPlugin(pluginDir, reason, settingPath = null) {
    const normalizedDir = this.normalizeName(pluginDir);
    const info = {
      directory: pluginDir,
      settingPath: settingPath || path.join(this.rootPath, pluginDir, 'setting.json'),
      reason,
      recordedAt: new Date().toISOString(),
    };
    this.invalidRegistry.set(normalizedDir, info);
    return info;
  }

  // 登錄插件設定，僅記錄合法設定與路徑
  registerPluginDirectory(pluginDir) {
    const normalizedDir = this.normalizeName(pluginDir);
    let settingPath = path.join(this.rootPath, pluginDir, 'setting.json');

    try {
      const info = this.readPluginSetting(pluginDir);
      settingPath = info.settingPath;
      const metadata = this.validatePluginSetting(info.setting, pluginDir, info.settingPath);
      const previousId = this.directoryIndex.get(normalizedDir);
      if (previousId && previousId !== metadata.id) {
        this.pluginRegistry.delete(previousId);
        this.plugins.delete(previousId);
        this.llmPlugins.delete(previousId);
      }
      const existedMeta = this.pluginRegistry.get(metadata.id);
      if (existedMeta) {
        metadata.loaded = existedMeta.loaded;
        metadata.lastError = existedMeta.lastError;
      }
      this.pluginRegistry.set(metadata.id, metadata);
      this.directoryIndex.set(normalizedDir, metadata.id);
      this.invalidRegistry.delete(normalizedDir);

      const existedPlugin = this.plugins.get(metadata.id);
      if (existedPlugin) {
        existedPlugin.metadata = { ...metadata };
      }

      Logger.info(`[PluginManager] 已登錄插件設定：${metadata.name}（目錄：${pluginDir}）`);
      return metadata;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.recordInvalidPlugin(pluginDir, reason, settingPath);

      const existedId = this.directoryIndex.get(normalizedDir);
      if (existedId) {
        this.pluginRegistry.delete(existedId);
        this.plugins.delete(existedId);
        this.llmPlugins.delete(existedId);
        this.directoryIndex.delete(normalizedDir);
      }

      Logger.warn(`[PluginManager] 登錄插件 ${pluginDir} 時發生錯誤：${reason}`);
      return null;
    }
  }

  // 掃描 plugins 目錄並登錄所有合法插件，回傳掃描摘要
  scanPluginDirectories() {
    this.lastScanTime = Date.now();
    const summary = { total: 0, registered: 0, invalid: 0 };
    let entries = [];

    try {
      entries = fs.readdirSync(this.rootPath, { withFileTypes: true });
    } catch (err) {
      Logger.error(`[PluginManager] 掃描插件目錄失敗：${err.message}`);
      return summary;
    }

    const activeDirectories = new Set();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = entry.name;
      summary.total += 1;
      const normalizedDir = this.normalizeName(dir);
      activeDirectories.add(normalizedDir);
      const metadata = this.registerPluginDirectory(dir);
      if (metadata) {
        summary.registered += 1;
      } else {
        summary.invalid += 1;
      }
    }

    this.cleanupOrphanedRegistry(activeDirectories);

    return summary;
  }

  // 清理註冊表中已不存在的插件資料夾與對應快取
  cleanupOrphanedRegistry(activeDirectories) {
    const normalizedDirectories = new Set(activeDirectories);

    for (const [dirKey, id] of Array.from(this.directoryIndex.entries())) {
      if (!normalizedDirectories.has(dirKey)) {
        this.directoryIndex.delete(dirKey);
      }
    }

    for (const [id, meta] of Array.from(this.pluginRegistry.entries())) {
      const dirKey = this.normalizeName(meta.directory);
      if (!normalizedDirectories.has(dirKey)) {
        this.pluginRegistry.delete(id);
        if (this.plugins.has(id)) {
          this.plugins.delete(id);
        }
        if (this.llmPlugins.has(id)) {
          this.llmPlugins.delete(id);
        }
        Logger.warn(`[PluginManager] 偵測到遺失的插件目錄 ${meta.directory}，已解除註冊`);
      }
    }

    for (const dirKey of Array.from(this.invalidRegistry.keys())) {
      if (!normalizedDirectories.has(dirKey)) {
        this.invalidRegistry.delete(dirKey);
      }
    }
  }

  // 確保插件實例已載入，如未載入則動態 require
  async ensurePluginInstance(id, mode = 'auto') {
    const existed = this.plugins.get(id);
    if (existed) {
      return existed;
    }

    const metadata = this.pluginRegistry.get(id);
    if (!metadata) {
      Logger.warn(`[PluginManager] 找不到插件 ${id} 的設定，已無法載入`);
      return null;
    }

    try {
      const plugin = await this.loadPlugin(metadata.name, mode);
      return plugin;
    } catch (err) {
      Logger.error(`[PluginManager] 啟動插件 ${metadata.name} 失敗：${err.message}`);
      return null;
    }
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
    let targetId = this.resolvePluginId(name);

    // 若尚未登錄，嘗試掃描並重新定位
    if (!targetId && this.shouldRescanDirectories()) {
      this.scanPluginDirectories();
      targetId = this.resolvePluginId(name);
    }

    // 嘗試以資料夾名稱直接登錄
    if (!targetId && typeof name === 'string') {
      try {
        const pluginDirPath = path.join(this.rootPath, name);
        if (fs.existsSync(pluginDirPath) && fs.statSync(pluginDirPath).isDirectory()) {
          const metadata = this.registerPluginDirectory(name);
          if (metadata) {
            targetId = metadata.id;
          }
        }
      } catch (err) {
        Logger.warn(`[PluginManager] 檢查插件資料夾 ${name} 時發生錯誤：${err.message}`);
      }
    }

    if (!targetId) {
      throw new Error(`找不到插件 ${name} 的設定，請確認 setting.json 是否存在`);
    }

    const metadata = this.pluginRegistry.get(targetId);
    if (!metadata) {
      throw new Error(`插件 ${name} 尚未完成登錄程序`);
    }

    if (this.plugins.has(targetId)) {
      const plugin = this.plugins.get(targetId);
      if (typeof plugin.updateStrategy === 'function') {
        try {
          await plugin.updateStrategy(mode);
        } catch (err) {
          Logger.warn(`[PluginManager] 更新插件 ${plugin.pluginName} 策略失敗：${err.message}`);
        }
      }
      const runtimePriority = typeof plugin.priority === 'number' ? plugin.priority : metadata.priority;
      const updatedMetadata = {
        ...metadata,
        priority: runtimePriority,
        loaded: true,
        lastError: null,
      };
      this.pluginRegistry.set(targetId, updatedMetadata);
      plugin.metadata = { ...updatedMetadata };
      if (updatedMetadata.pluginType === 'LLM') {
        this.llmPlugins.set(targetId, plugin);
      } else {
        this.llmPlugins.delete(targetId);
      }
      return plugin;
    }

    try {
      const plugin = require(metadata.indexPath);
      plugin.pluginName = metadata.name;
      if (metadata.pluginType) {
        plugin.pluginType = metadata.pluginType;
      }
      plugin.metadata = { ...metadata };

      if (!this.requestReview(plugin)) {
        throw new Error(`插件 ${metadata.name} 不符合要求`);
      }

      if (typeof plugin.priority !== 'number') {
        plugin.priority = metadata.priority;
      }

      if (typeof plugin.updateStrategy === 'function') {
        try {
          await plugin.updateStrategy(mode);
        } catch (err) {
          throw new Error(`更新策略失敗：${err.message}`);
        }
      }

      const runtimePriority = typeof plugin.priority === 'number' ? plugin.priority : metadata.priority;
      const updatedMetadata = {
        ...metadata,
        priority: runtimePriority,
        loaded: true,
        lastError: null,
      };
      this.pluginRegistry.set(targetId, updatedMetadata);
      plugin.metadata = { ...updatedMetadata };

      this.plugins.set(targetId, plugin);
      if (updatedMetadata.pluginType === 'LLM') {
        this.llmPlugins.set(targetId, plugin);
      } else {
        this.llmPlugins.delete(targetId);
      }

      Logger.info(`[PluginManager] 載入插件 ${metadata.name}`);
      return plugin;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const meta = this.pluginRegistry.get(targetId);
      if (meta) {
        meta.loaded = false;
        meta.lastError = errorMessage;
        this.pluginRegistry.set(targetId, { ...meta });
      }
      throw new Error(`載入插件 ${metadata.name} 失敗：${errorMessage}`);
    }
  }

  /**
   * 載入所有插件
   * @returns {Promise<void>}
   */
  async loadAllPlugins() {
    Logger.info("正在掃描所有插件設定");
    const summary = this.scanPluginDirectories();
    Logger.info(
      `[PluginManager] 插件掃描完成：總計 ${summary.total} 項，已登錄 ${summary.registered} 項，無效 ${summary.invalid} 項`
    );
    if (summary.invalid > 0) {
      const invalidList = this.getInvalidPlugins()
        .map(info => `${info.directory} (${info.reason})`)
        .join('; ');
      Logger.warn(`[PluginManager] 無效插件清單：${invalidList}`);
    }
  }

    /**
   * 傳送資料給指定插件
   * @param {string} name - 插件名稱
   * @param {any} data - 傳送的資料內容
   * @returns {Promise<resolve> || true} 反傳回的內容 或是 true
   */
  async send(name, data) {
    const resolvedId = this.resolvePluginId(name);
    const normalized = this.normalizeName(name);
    const targetId = resolvedId || normalized;

    if (!resolvedId && !this.pluginRegistry.has(targetId) && !this.plugins.has(targetId)) {
      const label = typeof name === 'string' ? name : String(name);
      Logger.warn(`[PluginManager] 找不到插件 ${label} 的設定，無法傳送資料`);
      return false;
    }

    const plugin = await this.ensurePluginInstance(targetId);
    const metadata = this.pluginRegistry.get(targetId);
    const fallbackName = metadata?.name || (typeof name === 'string' ? name : String(name));

    if (!plugin) {
      Logger.warn(`[PluginManager] 插件 ${fallbackName} 尚未載入，無法傳送資料`);
      return false;
    }

    if (await plugin.state() == 0) {
      const label = plugin.pluginName || fallbackName;
      Logger.warn(`[PluginManager] 插件 ${label} 當前狀態為離線，無法傳送資料`);
      return false;
    }

    if (typeof plugin.send === "function") {
      try {
        const resolve = plugin.send(data);
        const label = plugin.pluginName || fallbackName;
        Logger.info(`[PluginManager] 傳送資料給插件 ${label} 成功：${JSON.stringify(data)}`);
        return resolve || true; // 如果 send 方法沒有返回值，則返回 true
      } catch (err) {
        const label = plugin.pluginName || fallbackName;
        Logger.error(`[PluginManager] 傳送資料給插件 ${label} 失敗：${err.message}`);
        return false;
      }
    } else {
      const label = plugin.pluginName || fallbackName;
      Logger.warn(`[PluginManager] 插件 ${label} 未實作 send(data)，忽略傳送`);
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
    const resolvedId = this.resolvePluginId(name);
    const normalized = this.normalizeName(name);
    const targetId = resolvedId || normalized;

    if (!resolvedId && !this.pluginRegistry.has(targetId) && !this.plugins.has(targetId)) {
      const label = typeof name === 'string' ? name : String(name);
      Logger.warn(`[Queue] 插件 ${label} 尚未登錄，無法啟動`);
      return false;
    }

    const plugin = await this.ensurePluginInstance(targetId, options.mode);
    const metadata = this.pluginRegistry.get(targetId);
    const fallbackName = metadata?.name || (typeof name === 'string' ? name : String(name));
    const label = plugin?.pluginName || fallbackName;

    if (!plugin?.online) {
      Logger.warn(`[Queue] 插件 ${label} 無法啟動（尚未載入或缺少 online 方法）`);
      return false;
    }

    // 原子檢查：檢查是否已在佇列中或已上線，防止重複加入
    const queueKey = targetId;
    if (this.queuedPlugins.has(queueKey)) {
      Logger.warn(`[Queue] 插件 ${label} 已在佇列中，忽略重複加入`);
      return false;
    }

    // 立即標記為正在處理，防止併發問題
    this.queuedPlugins.add(queueKey);

    try {
      // 檢查插件狀態，避免重複啟動
      const state = await this.getPluginState(queueKey);
      if (state === 1) {
        Logger.warn(`[Queue] 插件 ${label} 已在線上，忽略重複啟動`);
        this.queuedPlugins.delete(queueKey); // 移除標記
        return false;
      }
    } catch (err) {
      Logger.error(`[Queue] 取得插件 ${label} 狀態失敗：${err.message}`);
      this.queuedPlugins.delete(queueKey); // 移除標記
      return false;
    }

    // 用 Promise 包一層「包進 queue 後會觸發執行」的邏輯
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        Logger.info(`[Queue] 開始啟動插件：${label}`);
        try {
          await plugin.online(options);  // 這裡的 online 是真實啟動流程
          Logger.info(`[Queue] 插件 ${label} 啟動完成`);
          resolve(true); // 👈 當 queue 執行這件事完畢，才 resolve
        } catch (err) {
          Logger.error(`[Queue] 啟動插件 ${label} 失敗：${err.message}`);
          reject(err);
        } finally {
          // 從佇列中移除標記
          this.queuedPlugins.delete(queueKey);
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
    // 依照 priority 由高至低排序，數值相同保持註冊順序
    const arr = Array.from(this.pluginRegistry.values());
    arr.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const meta of arr) {
      await this.queueOnline(meta.name, options);
    }
  }

  /**
   * 啟動指定插件
   * @param {string} name - 插件名稱
   * @returns {Promise<boolean>} 成功返回 true，失敗返回 false
   */
  async offline(name) {
    const resolvedId = this.resolvePluginId(name);
    const normalized = this.normalizeName(name);
    const targetId = resolvedId || normalized;

    if (!resolvedId && !this.pluginRegistry.has(targetId) && !this.plugins.has(targetId)) {
      const label = typeof name === 'string' ? name : String(name);
      Logger.warn(`[PluginManager] 插件 ${label} 尚未登錄或尚未載入`);
      return false;
    }

    const plugin = this.plugins.get(targetId);
    const metadata = this.pluginRegistry.get(targetId);
    const fallbackName = metadata?.name || (typeof name === 'string' ? name : String(name));

    if (!plugin?.offline) {
      Logger.warn(`[PluginManager] 插件 ${fallbackName} 尚未載入或不支援離線`);
      return false;
    }

    if (await plugin.state() === 0) {
      const label = plugin.pluginName || fallbackName;
      Logger.warn(`[PluginManager] 插件 ${label} 已經處於離線狀態`);
      return true; // 已經離線，無需再次關閉
    }

    try {
      await plugin.offline();
      const label = plugin.pluginName || fallbackName;
      Logger.info(`[PluginManager] 成功關閉插件：${label}`);
      return true;
    } catch (err) {
      const label = plugin.pluginName || fallbackName;
      Logger.error(`[PluginManager] 關閉插件 ${label} 失敗：${err.message}`);
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
    const resolvedId = this.resolvePluginId(name);
    const normalized = this.normalizeName(name);
    const targetId = resolvedId || normalized;

    const plugin = this.plugins.get(targetId);
    if (plugin?.state) {
      return await plugin.state();
    }
    return -2;
  }

  /**
   * 載入所有LLM插件
   */
  async loadAllLLMPlugins(mode = 'auto') {
    Logger.info("正在嘗試載入所有 LLM 插件");
    if (this.pluginRegistry.size === 0) {
      this.scanPluginDirectories();
    }

    const llmMetas = Array.from(this.pluginRegistry.values()).filter(meta => meta.pluginType === 'LLM');
    if (llmMetas.length === 0) {
      Logger.warn('[PluginManager] 尚未登錄任何 LLM 插件');
      return [];
    }

    const loaded = [];
    for (const meta of llmMetas) {
      try {
        const plugin = await this.loadPlugin(meta.name, mode);
        if (plugin) {
          loaded.push(plugin);
        }
      } catch (err) {
        Logger.error(`[PluginManager] 載入 LLM 插件 ${meta.name} 失敗：${err.message}`);
      }
    }

    return loaded;
  }

  /**
   * 取得指定名稱的 LLM 插件
   * @param {string} name
   * @returns {object|null}
   */
  getLLMPlugin(name) {
    const resolvedId = this.resolvePluginId(name);
    const normalized = this.normalizeName(name);
    const targetId = resolvedId || normalized;
    return this.llmPlugins.get(targetId) || null;
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
    await this.loadAllLLMPlugins(options.mode);


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
    const id = this.resolvePluginId(name);
    if (!id) return null;
    const metadata = this.pluginRegistry.get(id);
    return metadata ? { ...metadata } : null;
  }

  /**
   * 取得無效插件清單
   * @returns {Array<{directory:string, settingPath:string, reason:string, recordedAt:string}>}
   */
  getInvalidPlugins() {
    return Array.from(this.invalidRegistry.values()).map(info => ({ ...info }));
  }
}

module.exports = new PluginsManager();
