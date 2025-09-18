jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    getLogPath: jest.fn().mockReturnValue('')
  }));
});

const fs = require('fs');
const os = require('os');
const path = require('path');

// 預設插件程式碼，提供最小但完整的接口實作
const DEFAULT_PLUGIN_CONTENT = `module.exports = {
  async updateStrategy() {
    return 'ok';
  },
  async online() {
    return true;
  },
  async offline() {
    return true;
  },
  async restart() {
    return true;
  },
  async state() {
    return 0;
  },
  async send(payload) {
    return payload || null;
  }
};
`;

function writePlugin(root, dirName, setting, indexContent = DEFAULT_PLUGIN_CONTENT) {
  const pluginDir = path.join(root, dirName);
  fs.mkdirSync(pluginDir, { recursive: true });
  if (setting !== null && setting !== undefined) {
    const settingPath = path.join(pluginDir, 'setting.json');
    if (typeof setting === 'string') {
      fs.writeFileSync(settingPath, setting, 'utf-8');
    } else {
      fs.writeFileSync(settingPath, JSON.stringify(setting, null, 2), 'utf-8');
    }
  }
  if (indexContent !== undefined && indexContent !== null) {
    fs.writeFileSync(path.join(pluginDir, 'index.js'), indexContent, 'utf-8');
  }
}

function cleanupRequireCache(targetDir) {
  const prefix = path.resolve(targetDir);
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) {
      delete require.cache[key];
    }
  }
}

describe('PluginsManager 設定外置化流程', () => {
  let PM;
  let tempRoot;
  let originalRoot;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    PM = require('../src/core/pluginsManager');
    originalRoot = PM.rootPath;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-registry-'));

    PM.rootPath = tempRoot;
    PM.pluginRegistry.clear();
    PM.directoryIndex.clear();
    PM.plugins.clear();
    PM.llmPlugins.clear();
    PM.invalidRegistry.clear();
    PM.queue = [];
    PM.running = false;
    PM.queuedPlugins = new Set();
    PM.exceptionLLM = new Set();
  });

  afterEach(() => {
    cleanupRequireCache(tempRoot);
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    PM.rootPath = originalRoot;
  });

  test('掃描時應跳過缺少或錯誤的設定並記錄原因', () => {
    writePlugin(tempRoot, 'alpha', { name: 'alpha', priority: 5, pluginType: 'Tool' });
    writePlugin(tempRoot, 'beta', { name: 'beta' });
    writePlugin(tempRoot, 'gamma', '{"name": "gamma",');
    writePlugin(tempRoot, 'delta', { name: 'delta', priority: 2 }, null);

    const summary = PM.scanPluginDirectories();

    expect(summary.total).toBe(4);
    expect(summary.registered).toBe(1);
    expect(summary.invalid).toBe(3);
    expect(PM.pluginRegistry.size).toBe(1);
    expect(PM.pluginRegistry.has('alpha')).toBe(true);

    const invalidList = PM.getInvalidPlugins();
    expect(invalidList).toHaveLength(3);

    const reasonMap = invalidList.reduce((acc, item) => {
      acc[item.directory] = item.reason;
      return acc;
    }, {});

    expect(reasonMap.beta).toMatch(/priority/);
    expect(reasonMap.gamma).toMatch(/解析/);
    expect(reasonMap.delta).toMatch(/index\.js/);
  });

  test('合法插件應在需要時才載入並能於目錄移除後清除紀錄', async () => {
    writePlugin(tempRoot, 'omega', { name: 'omega', priority: 3 });

    const summary = PM.scanPluginDirectories();
    expect(summary.registered).toBe(1);
    expect(PM.plugins.size).toBe(0);

    const plugin = await PM.loadPlugin('omega');
    expect(typeof plugin.online).toBe('function');
    expect(PM.plugins.has('omega')).toBe(true);

    fs.rmSync(path.join(tempRoot, 'omega'), { recursive: true, force: true });

    const rescan = PM.scanPluginDirectories();
    expect(rescan.total).toBe(0);
    expect(PM.pluginRegistry.size).toBe(0);
    expect(PM.plugins.size).toBe(0);
    expect(PM.directoryIndex.size).toBe(0);
    expect(PM.getInvalidPlugins()).toHaveLength(0);
  });
});
