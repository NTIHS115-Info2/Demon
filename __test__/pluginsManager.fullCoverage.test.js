jest.mock('../src/utils/logger', () => {
  // 以簡單的假物件取代真實 logger，避免測試期間寫入檔案
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    Original: jest.fn(),
    logRaw: jest.fn(),
    getLogPath: jest.fn().mockReturnValue('/tmp'),
  }));
});

jest.mock('axios', () => {
  // 模擬 axios 與 axios.get，確保載入插件時不會觸發真實的 HTTP 請求
  const mockAxios = jest.fn(() => Promise.resolve({ data: {} }));
  mockAxios.get = jest.fn(() => Promise.resolve({ data: {} }));
  mockAxios.post = jest.fn(() => Promise.resolve({ data: {} }));
  mockAxios.create = jest.fn(() => mockAxios);
  return mockAxios;
});

jest.mock('../src/plugins/discord/configLoader', () => ({
  // 提供最小但合法的假設定，避免測試環境缺少真實設定檔時出錯
  token: 'TEST_TOKEN',
  applicationId: 'TEST_APP',
  guildId: 'TEST_GUILD',
  channelId: 'TEST_CHANNEL',
  intents: ['Guilds'],
  reconnect: { maxRetries: 0, retryDelay: 0 },
}));

const fs = require('fs');
const path = require('path');

describe('PluginsManager 插件規範完整覆蓋測試', () => {
  let PM;
  let scanSummary = { total: 0, registered: 0, invalid: 0 };
  let metadataList = [];
  const loadedPlugins = new Map();

  beforeAll(() => {
    // 重置模組快取，確保 PluginsManager 以乾淨狀態載入
    jest.resetModules();
    jest.clearAllMocks();

    PM = require('../src/core/pluginsManager');

    // 清理殘留狀態，避免影響掃描與載入結果
    PM.plugins.clear();
    PM.llmPlugins.clear();
    PM.pluginRegistry.clear();
    PM.directoryIndex.clear();
    PM.invalidRegistry.clear();
    PM.queue = [];
    PM.running = false;
    PM.queuedPlugins = new Set();
    PM.exceptionLLM = new Set();
    PM.lastScanTime = 0;

    scanSummary = PM.scanPluginDirectories();
    metadataList = Array.from(PM.pluginRegistry.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  afterAll(() => {
    // 測試完成後清理 PluginsManager 狀態，並重新掃描以恢復原始資料
    PM.plugins.clear();
    PM.llmPlugins.clear();
    PM.pluginRegistry.clear();
    PM.directoryIndex.clear();
    PM.invalidRegistry.clear();
    PM.queue = [];
    PM.running = false;
    PM.queuedPlugins = new Set();
    PM.exceptionLLM = new Set();
    PM.lastScanTime = 0;
    PM.scanPluginDirectories();
  });

  test('掃描結果應全數通過基本設定檢查', () => {
    // 若沒有掃描到任何插件代表測試環境異常
    if (scanSummary.total === 0) {
      throw new Error('未掃描到任何插件，請確認 src/plugins 目錄是否存在');
    }

    expect(scanSummary.total).toBeGreaterThan(0);
    expect(scanSummary.registered).toBe(metadataList.length);
    expect(scanSummary.invalid).toBe(0);

    metadataList.forEach((meta) => {
      // 確保必要欄位存在，並驗證設定檔與入口檔案均存在
      expect(meta.name).toBeTruthy();
      expect(typeof meta.priority).toBe('number');
      expect(meta.directory).toBeTruthy();
      expect(meta.settingPath).toBeTruthy();
      expect(meta.indexPath).toBeTruthy();
      expect(fs.existsSync(meta.settingPath)).toBe(true);
      expect(fs.existsSync(meta.indexPath)).toBe(true);
    });
  });

  test('所有插件皆須通過接口審查與規範檢查', async () => {
    if (metadataList.length === 0) {
      throw new Error('無可檢查的插件，測試無法繼續');
    }

    const requiredMethods = ['updateStrategy', 'online', 'offline', 'restart', 'state'];

    for (const meta of metadataList) {
      let pluginInstance;

      try {
        // 透過 PluginsManager 載入插件，確保流程符合實際運作
        pluginInstance = await PM.loadPlugin(meta.name);
      } catch (error) {
        throw new Error(`載入插件 ${meta.name} 失敗：${error.message}`);
      }

      loadedPlugins.set(meta.name, pluginInstance);

      // 檢查必要方法是否全部存在
      const missingMethods = requiredMethods.filter(method => typeof pluginInstance[method] !== 'function');
      if (missingMethods.length > 0) {
        throw new Error(`插件 ${meta.name} 缺少必要方法：${missingMethods.join(', ')}`);
      }

      if (Object.prototype.hasOwnProperty.call(pluginInstance, 'send')) {
        expect(typeof pluginInstance.send).toBe('function');
      } else if (meta.pluginType === 'LLM') {
        throw new Error(`LLM 插件 ${meta.name} 必須實作 send() 介面`);
      }

      // 再次確認 PluginsManager 寫入的 metadata 與設定一致
      expect(pluginInstance.metadata.name).toBe(meta.name);
      expect(pluginInstance.metadata.directory).toBe(meta.directory);
      expect(pluginInstance.metadata.pluginType).toBe(meta.pluginType);
      expect(pluginInstance.metadata.loaded).toBe(true);
      expect(typeof pluginInstance.priority).toBe('number');

      if (meta.pluginType === 'LLM') {
        const descriptionPath = path.join(PM.rootPath, meta.directory, 'tool-description.json');
        if (!fs.existsSync(descriptionPath)) {
          throw new Error(`LLM 插件 ${meta.name} 缺少工具描述檔案：${descriptionPath}`);
        }
        let raw;
        try {
          raw = fs.readFileSync(descriptionPath, 'utf-8');
        } catch (error) {
          throw new Error(`讀取 LLM 插件 ${meta.name} 的工具描述檔案時發生錯誤：${error.message}`);
        }
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error(`解析 LLM 插件 ${meta.name} 的工具描述檔案 JSON 時發生錯誤：${error.message}`);
        }
        expect(parsed.toolName).toBeTruthy();
        expect(parsed.description).toBeTruthy();
        expect(parsed.output).toBeDefined();
      }
    }
  });

  test('LLM 插件應成功登錄於 llmPlugins 索引中，非 LLM 插件不得誤入', () => {
    // 依據 pluginType 分類插件，確保後續檢查清楚易懂
    const llmMetadata = metadataList.filter(meta => meta.pluginType === 'LLM');
    const nonLlmMetadata = metadataList.filter(meta => meta.pluginType !== 'LLM');

    // 每個合法的 LLM 插件都應該在 llmPlugins 集合中
    llmMetadata.forEach((meta) => {
      const pluginId = meta.id || PM.normalizeName(meta.name);
      expect(PM.llmPlugins.has(pluginId)).toBe(true);
      const storedInstance = PM.llmPlugins.get(pluginId);
      expect(storedInstance).toBe(loadedPlugins.get(meta.name));
    });

    // 對於非 LLM 插件，特別是 toolReference 等工具型插件，不應被誤分類
    nonLlmMetadata.forEach((meta) => {
      const pluginId = meta.id || PM.normalizeName(meta.name);
      expect(PM.llmPlugins.has(pluginId)).toBe(false);
    });
  });

  test('getPluginMetadata 應回傳最新的插件資訊', () => {
    metadataList.forEach((meta) => {
      const runtimeMetadata = PM.getPluginMetadata(meta.name);
      expect(runtimeMetadata).not.toBeNull();
      expect(runtimeMetadata.name).toBe(meta.name);
      expect(runtimeMetadata.loaded).toBe(true);
      expect(typeof runtimeMetadata.priority).toBe('number');
    });
  });
});
