// __tests__/pluginsManager.test.js
//
// 測試 PluginsManager 的核心生命週期方法
// 引入 pluginManager 實作 :contentReference[oaicite:0]{index=0}

const PluginManager = require('../src/core/pluginsManager');

describe('PluginsManager 核心功能', () => {
  let mockPlugin;

  beforeEach(() => {
    // 清空並注入一個 id 為 "llama" 的 mock plugin
    PluginManager.plugins.clear();
    mockPlugin = {
      online: jest.fn().mockResolvedValue(true),
      offline: jest.fn().mockResolvedValue(),
      restart: jest.fn().mockResolvedValue(),
      state: jest.fn().mockResolvedValue(1)
    };
    PluginManager.plugins.set('llama', mockPlugin);
  });

  test('queueOnline 應呼叫 plugin.online 並回傳成功', async () => {
    await expect(PluginManager.queueOnline('llama', {preset:'exclusive'})).resolves.toBe(true);
    expect(mockPlugin.online).toHaveBeenCalledWith({preset:'exclusive'});
  });

  test('getPluginState 應回傳 plugin.state 的結果', async () => {
    const state = await PluginManager.getPluginState('llama');
    expect(state).toBe(1);
    expect(mockPlugin.state).toHaveBeenCalled();
  });

  test('offlineAll 應對所有 plugins 呼叫 offline()', async () => {
    await PluginManager.offlineAll();
    expect(mockPlugin.offline).toHaveBeenCalled();
  });

  test('restartAll 應對所有 plugins 呼叫 restart()', async () => {
    await PluginManager.restartAll({foo:'bar'});
    expect(mockPlugin.restart).toHaveBeenCalledWith({foo:'bar'});
  });
});
