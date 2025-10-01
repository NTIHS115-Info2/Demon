const fs = require('fs');
const path = require('path');
const Logger = require('../../../../utils/logger');

// 建立 logger，輸出至 toolReferenceLocal.log
const logger = new Logger('toolReferenceLocal.log');

// 常數設定
const TOOL_DESCRIPTION_FILE = 'tool-description.json'; // 工具描述檔案名稱
const SUMMARY_MAX_LENGTH = 120; // 粗略描述的最大長度
const priority = 50; // 策略啟動優先度

// 快取與監控狀態
let descriptionCache = null; // 儲存最新的工具描述資料
let isOnline = false; // 策略是否已上線
const watchers = new Map(); // 監控器對照表 (key: 路徑, value: fs.FSWatcher)
let reloadTimer = null; // 延遲重新載入的計時器

/**
 * 清除等待中的重新載入計時器，避免頻繁觸發
 */
function clearReloadTimer() {
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
}

/**
 * 關閉所有檔案監控，確保釋放系統資源
 */
function disposeWatchers() {
  for (const [watchedPath, watcher] of watchers.entries()) {
    try {
      watcher.close();
    } catch (err) {
      logger.warn(`關閉檔案監控時發生錯誤 (${watchedPath}): ${err.message}`);
    }
  }
  watchers.clear();
}

/**
 * 取得 plugins 目錄下所有子資料夾名稱
 * @param {string} rootPath 插件根目錄
 * @returns {string[]} 插件資料夾清單
 */
function listPluginDirs(rootPath) {
  try {
    return fs.readdirSync(rootPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch (err) {
    logger.error(`讀取插件目錄失敗：${err.message}`);
    return [];
  }
}

/**
 * 將工具描述壓縮為單行文字，避免佔用過多篇幅
 * @param {string} description 完整描述
 * @returns {string} 粗略描述
 */
function createSummaryText(description) {
  if (typeof description !== 'string') return '';
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= SUMMARY_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * 將輸入統一拆解為工具名稱陣列
 * @param {unknown} value 任意可能的輸入型別
 * @returns {string[]} 工具名稱清單
 */
function splitNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap(item => splitNames(item));
  }

  if (typeof value === 'string') {
    return value
      .split(/[,，\n]/)
      .map(text => text.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  if (value && typeof value === 'object') {
    const candidate = value.toolName || value.name;
    if (candidate) return splitNames(candidate);
  }

  return [];
}

/**
 * 依序去除重複的工具名稱（不區分大小寫）
 * @param {string[]} names 原始名稱陣列
 * @returns {string[]} 去重後的名稱陣列
 */
function uniquePreserveOrder(names) {
  const seen = new Set();
  const result = [];

  for (const rawName of names) {
    if (typeof rawName !== 'string') continue;
    const trimmed = rawName.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

/**
 * 讀取所有插件的工具描述，並整理為快取物件
 * @param {string} rootPath 插件根目錄
 * @returns {{generatedAt:string,pluginNames:string[],pluginMap:Map<string,object[]>,toolMap:Map<string,object>,lowerCaseMap:Map<string,string>}}
 */
function readDescriptions(rootPath) {
  const pluginNames = listPluginDirs(rootPath);
  const pluginMap = new Map();
  const toolMap = new Map();
  const lowerCaseMap = new Map();

  for (const pluginName of pluginNames) {
    const filePath = path.join(rootPath, pluginName, TOOL_DESCRIPTION_FILE);

    if (!fs.existsSync(filePath)) {
      logger.info(`插件 ${pluginName} 無工具描述檔案，略過`);
      continue;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const normalizedRecords = [];

      entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          logger.warn(`插件 ${pluginName} 的工具描述第 ${index + 1} 筆資料格式錯誤`);
          return;
        }

        const { toolName, description } = entry;

        if (!toolName || !description) {
          logger.warn(`插件 ${pluginName} 的工具描述缺少必要欄位 (toolName/description)`);
          return;
        }

        const record = {
          pluginName,
          toolName: String(toolName).trim(),
          description: String(description),
          summary: createSummaryText(description),
          definition: entry,
          source: path.relative(rootPath, filePath).replace(/\\/g, '/'),
        };

        if (toolMap.has(record.toolName)) {
          logger.warn(`偵測到重複的工具名稱 ${record.toolName}，將覆寫為最新版本`);
        }

        toolMap.set(record.toolName, record);
        lowerCaseMap.set(record.toolName.toLowerCase(), record.toolName);
        normalizedRecords.push(record);
      });

      if (normalizedRecords.length > 0) {
        pluginMap.set(pluginName, normalizedRecords);
        logger.info(`成功載入插件 ${pluginName} 的 ${normalizedRecords.length} 筆工具描述`);
      }
    } catch (err) {
      logger.warn(`讀取插件 ${pluginName} 的工具描述失敗：${err.message}`);
    }
  }

  logger.info(`目前快取共收錄 ${toolMap.size} 個工具描述`);
  return {
    generatedAt: new Date().toISOString(),
    pluginNames,
    pluginMap,
    toolMap,
    lowerCaseMap,
  };
}

/**
 * 建立或更新檔案監控，以便在工具描述變更時重新載入
 * @param {string} rootPath 插件根目錄
 * @param {string[]} pluginNames 插件名稱列表
 */
function attachWatchers(rootPath, pluginNames) {
  // 1. 建立根目錄監控，用來偵測插件資料夾新增/刪除
  if (!watchers.has(rootPath)) {
    try {
      const rootWatcher = fs.watch(rootPath, (eventType, filename) => {
        if (!filename) return;
        logger.info(`偵測到插件根目錄變更 (${eventType}): ${filename}`);
        scheduleReload(rootPath, 'plugin-structure');
      });
      watchers.set(rootPath, rootWatcher);
    } catch (err) {
      logger.warn(`無法監控插件根目錄：${err.message}`);
    }
  }

  const validPlugins = new Set(pluginNames);

  // 2. 移除已不存在的插件監控
  for (const [watchedPath, watcher] of [...watchers.entries()]) {
    if (watchedPath === rootPath) continue;
    const pluginName = path.basename(watchedPath);
    if (!validPlugins.has(pluginName)) {
      try {
        watcher.close();
      } catch (err) {
        logger.warn(`關閉插件 ${pluginName} 的監控失敗：${err.message}`);
      }
      watchers.delete(watchedPath);
    }
  }

  // 3. 為每個插件建立監控，針對工具描述檔案
  for (const pluginName of validPlugins) {
    const pluginPath = path.join(rootPath, pluginName);
    if (watchers.has(pluginPath)) continue;

    try {
      const pluginWatcher = fs.watch(pluginPath, (eventType, filename) => {
        if (!filename) return;
        if (filename === TOOL_DESCRIPTION_FILE) {
          logger.info(`偵測到 ${pluginName}/${TOOL_DESCRIPTION_FILE} 變更 (${eventType})`);
          scheduleReload(rootPath, `${pluginName}-description`);
        }
      });
      watchers.set(pluginPath, pluginWatcher);
    } catch (err) {
      logger.warn(`無法監控插件 ${pluginName}：${err.message}`);
    }
  }
}

/**
 * 排程重新載入工具描述，避免頻繁處理磁碟 IO
 * @param {string} rootPath 插件根目錄
 * @param {string} reason 觸發原因
 */
function scheduleReload(rootPath, reason) {
  if (!isOnline) return;

  clearReloadTimer();
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    if (!isOnline) return;

    try {
      descriptionCache = readDescriptions(rootPath);
      attachWatchers(rootPath, descriptionCache.pluginNames);
      logger.info(`工具描述已重新整理（原因：${reason}），目前共 ${descriptionCache.toolMap.size} 個工具`);
    } catch (err) {
      logger.error(`重新整理工具描述失敗（原因：${reason}）：${err.message}`);
    }
  }, 200);
}

/**
 * 確保快取存在，若尚未載入則立即讀取
 * @param {string} rootPath 插件根目錄
 */
function ensureCache(rootPath) {
  if (!descriptionCache) {
    descriptionCache = readDescriptions(rootPath);
    attachWatchers(rootPath, descriptionCache.pluginNames);
  }
  return descriptionCache;
}

/**
 * 從物件參數收集工具名稱，並回傳額外偵測到的異常欄位
 * @param {object} source 請求物件
 * @returns {{names:string[],invalidKeys:string[]}}
 */
function collectNamesFromObject(source) {
  const names = [];
  const invalidKeys = [];

  // 逐一檢查物件屬性，僅允許符合規範的 toolName 欄位通過
  Object.entries(source).forEach(([key, value]) => {
    if (key === 'toolName') {
      names.push(...splitNames(value));
      return;
    }

    if (key === 'roughly' || key === 'filter' || key === 'keyword') {
      return;
    }

    invalidKeys.push(key);
  });

  return {
    names,
    invalidKeys,
  };
}

/**
 * 將傳入的資料轉換為內部可用的請求格式
 * @param {unknown} data 外部傳入的資料
 * @returns {{type:'roughly',roughly:true,filter?:string}|{type:'detail',toolNames:string[]}|{error:string}}
 */
function normalizeRequest(data) {
  if (data === null || data === undefined) {
    return { type: 'roughly', roughly: true };
  }

  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return { type: 'roughly', roughly: true };

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeRequest(parsed);
      } catch (err) {
        logger.warn(`字串請求 JSON 解析失敗：${err.message}`);
      }
    }

    const roughlyMatch = trimmed.match(/roughly\s*:\s*(true|false)/i);
    if (roughlyMatch) {
      const value = roughlyMatch[1].toLowerCase() === 'true';
      return value
        ? { type: 'roughly', roughly: true }
        : { error: '請提供 ToolName 以取得工具描述' };
    }

    const toolMatch = trimmed.match(/ToolName\s*:\s*(.+)/i);
    if (toolMatch) {
      const names = uniquePreserveOrder(splitNames(toolMatch[1]));
      if (names.length === 0) {
        return { error: 'ToolName 參數解析後為空' };
      }
      return { type: 'detail', toolNames: names };
    }

    return { error: '無法解析請求內容，請改以 ToolName: <名稱> 查詢' };
  }

  if (typeof data === 'object') {
    if (data.roughly === true) {
      const filter = typeof data.filter === 'string'
        ? data.filter.trim()
        : typeof data.keyword === 'string'
          ? data.keyword.trim()
          : undefined;
      return filter
        ? { type: 'roughly', roughly: true, filter }
        : { type: 'roughly', roughly: true };
    }

    if (data.roughly === false) {
      return { error: '請提供 ToolName 以取得工具描述' };
    }

    const { names, invalidKeys } = collectNamesFromObject(data);
    const uniqueNames = uniquePreserveOrder(names);

    // 若偵測到規範外的欄位，提前回傳錯誤提示
    if (invalidKeys.length > 0) {
      return { error: `偵測到不支援的查詢欄位：${invalidKeys.join(', ')}` };
    }

    // 當取得合法名稱時，組成 detail 模式請求
    if (uniqueNames.length > 0) {
      return { type: 'detail', toolNames: uniqueNames };
    }

    if (Object.keys(data).length === 0) {
      return { type: 'roughly', roughly: true };
    }

    return { error: '無法解析請求內容，請提供 toolName 欄位' };
  }

  return { error: '不支援的請求型別，請改用物件或字串' };
}

/**
 * 建立粗略清單，用於系統提示顯示
 * @param {{toolMap:Map<string,object>}} cache 工具描述快取
 * @param {string|undefined} filterText 篩選關鍵字
 * @returns {Array<{toolName:string,pluginName:string,description:string}>}
 */
function buildSummaryList(cache, filterText) {
  if (!cache) return [];

  let summary = Array.from(cache.toolMap.values()).map(record => ({
    toolName: record.toolName,
    pluginName: record.pluginName,
    description: record.summary || record.description,
  }));

  summary.sort((a, b) => a.toolName.localeCompare(b.toolName, 'zh-Hant'));

  if (filterText) {
    const keyword = filterText.toLowerCase();
    summary = summary.filter(item =>
      item.toolName.toLowerCase().includes(keyword) ||
      item.pluginName.toLowerCase().includes(keyword) ||
      item.description.toLowerCase().includes(keyword)
    );
  }

  return summary;
}

/**
 * 針對指定工具名稱回傳完整描述
 * @param {{toolMap:Map<string,object>,lowerCaseMap:Map<string,string>}} cache 工具描述快取
 * @param {string[]} requestedNames 要查詢的工具名稱
 * @returns {{success:boolean,mode:'detail',requested:string[],resolved:string[],missing?:string[],error?:string,tools:Array}}
 */
function buildDetailResponse(cache, requestedNames) {
  const tools = [];
  const missing = [];
  const resolved = [];

  for (const name of requestedNames) {
    const direct = cache.toolMap.get(name);
    let record = direct;

    if (!record) {
      const canonical = cache.lowerCaseMap.get(name.toLowerCase());
      if (canonical) {
        record = cache.toolMap.get(canonical);
      }
    }

    if (!record) {
      missing.push(name);
      continue;
    }

    resolved.push(record.toolName);
    tools.push({
      toolName: record.toolName,
      pluginName: record.pluginName,
      description: record.definition.description,
      definition: JSON.parse(JSON.stringify(record.definition)),
      source: record.source,
    });
  }

  const success = missing.length === 0;
  const response = {
    success,
    mode: 'detail',
    requested: requestedNames,
    resolved,
    generatedAt: cache.generatedAt,
    total: tools.length,
    tools,
  };

  if (!success) {
    response.missing = missing;
    response.error = `找不到以下工具描述：${missing.join(', ')}`;
  }

  return response;
}

module.exports = {
  priority,
  async updateStrategy() {},

  /**
   * 啟動策略並載入工具描述
   */
  async online() {
    const pluginsPath = path.resolve(__dirname, '../../..');
    disposeWatchers();
    clearReloadTimer();

    try {
      descriptionCache = readDescriptions(pluginsPath);
      attachWatchers(pluginsPath, descriptionCache.pluginNames);
      isOnline = true;
      logger.info(`ToolReference local 策略已啟動，共載入 ${descriptionCache.toolMap.size} 個工具描述`);
    } catch (err) {
      disposeWatchers();
      descriptionCache = null;
      isOnline = false;
      logger.error(`啟動失敗：${err.message}`);
      throw err;
    }
  },

  /**
   * 關閉策略並釋放資源
   */
  async offline() {
    clearReloadTimer();
    disposeWatchers();
    descriptionCache = null;
    isOnline = false;
    logger.info('ToolReference local 策略已關閉');
  },

  /**
   * 重新啟動策略
   * @param {object} options - 傳遞給 online 的選項（目前未使用）
   */
  async restart(options) {
    await this.offline();
    return this.online(options);
  },

  /**
   * 回傳策略狀態
   * @returns {Promise<number>} 1: 上線, 0: 離線
   */
  async state() {
    return isOnline ? 1 : 0;
  },

  /**
   * 回傳工具描述資料
   * @param {unknown} data 請求內容
   * @returns {Promise<object>} 回應結果
   */
  async send(data) {
    const pluginsPath = path.resolve(__dirname, '../../..');

    if (!isOnline) {
      const error = 'toolReference 尚未上線，請先啟動後再查詢';
      logger.warn(error);
      return { success: false, error };
    }

    try {
      const cache = ensureCache(pluginsPath);
      const request = normalizeRequest(data);

      if (request.error) {
        logger.warn(`收到無效的查詢請求：${request.error}，內容：${logger.safeStringify(data)}`);
        return { success: false, error: request.error };
      }

      if (request.type === 'roughly') {
        const summary = buildSummaryList(cache, request.filter);
        return {
          success: true,
          mode: 'roughly',
          generatedAt: cache.generatedAt,
          total: summary.length,
          filter: request.filter,
          tools: summary,
        };
      }

      if (request.type === 'detail') {
        if (!request.toolNames || request.toolNames.length === 0) {
          const error = '請至少提供一個 ToolName 以查詢詳細描述';
          logger.warn(error);
          return { success: false, error };
        }

        return buildDetailResponse(cache, request.toolNames);
      }

      const error = '未能判定請求類型，請確認輸入格式';
      logger.warn(error);
      return { success: false, error };
    } catch (err) {
      logger.error(`處理工具描述請求時發生錯誤：${err.message}`);
      return { success: false, error: `工具描述處理失敗：${err.message}` };
    }
  },
};
