jest.mock('../src/utils/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

// 建立測試用插件
function createPlugin(name, priority) {
  return {
    pluginName: name,
    priority,
    online: jest.fn().mockResolvedValue(true),
    offline: jest.fn().mockResolvedValue(true),
    restart: jest.fn(),
    state: jest.fn().mockResolvedValue(0),
    updateStrategy: jest.fn()
  };
}

describe('StartLLMTool 與 SetExceptionLLMTool 整合測試', () => {
  let PM, Logger, pluginA, pluginB, loggerInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    Logger = require('../src/utils/logger');
    PM = require('../src/core/pluginsManager');

    PM.plugins.clear();
    PM.llmPlugins.clear();
    PM.queue = [];
    PM.running = false;
    PM.queuedPlugins = new Set();
    PM.exceptionLLM = new Set();

    pluginA = createPlugin('alpha', 2);
    pluginB = createPlugin('beta', 1);
    PM.plugins.set('alpha', pluginA);
    PM.llmPlugins.set('alpha', pluginA);
    PM.plugins.set('beta', pluginB);
    PM.llmPlugins.set('beta', pluginB);

    loggerInstance = Logger.mock.results[0].value;
    loggerInstance.info.mockClear();
  });

  test('應只啟動非例外的 LLM 插件', async () => {
    const setOk = PM.SetExceptionLLMTool(['beta']);
    expect(setOk).toBe(true);

    const res = await PM.StartLLMTool();

    expect(res.started).toEqual(['alpha']);
    expect(res.skipped).toEqual(['beta']);
    expect(pluginA.online).toHaveBeenCalledTimes(1);
    expect(pluginB.online).not.toHaveBeenCalled();

    const infoCalls = loggerInstance.info.mock.calls.map(c => c[0]);
    expect(infoCalls.some(msg => msg.includes('例外插件清單'))).toBe(true);
    expect(infoCalls.some(msg => msg.includes('跳過啟動'))).toBe(true);
  });
});
