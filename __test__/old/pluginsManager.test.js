// __tests__/pluginsManager.test.js
//
// 測試 PluginsManager 的核心生命週期方法
// 引入 pluginManager 實作 :contentReference[oaicite:0]{index=0}

const PluginManager = require('../../src/core/pluginsManager');

describe('PluginsManager 核心功能', () => {
  let mockPlugin;

  beforeEach(() => {
    // 清空並注入一個 id 為 "llama" 的 mock plugin
    PluginManager.plugins.clear();
    mockPlugin = {
      priority: 1,
      online: jest.fn().mockResolvedValue(true),
      offline: jest.fn().mockResolvedValue(),
      restart: jest.fn().mockResolvedValue(),
      state: jest.fn().mockResolvedValue(0),
    };
    PluginManager.plugins.set('llama', mockPlugin);
  });

  test('queueOnline 應呼叫 plugin.online 並回傳成功', async () => {
    await expect(PluginManager.queueOnline('llama', {preset:'exclusive'})).resolves.toBe(true);
    expect(mockPlugin.online).toHaveBeenCalledWith({preset:'exclusive'});
  });

  test('getPluginState 應回傳 plugin.state 的結果', async () => {
    const state = await PluginManager.getPluginState('llama');
    expect(state).toBe(0);
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

  test('queueOnline 已上線時應跳過', async () => {
    mockPlugin.state.mockResolvedValue(1);
    const res = await PluginManager.queueOnline('llama');
    expect(res).toBe(false);
    expect(mockPlugin.online).not.toHaveBeenCalled();
  });

  test('queueAllOnline 應依優先度排序', async () => {
    PluginManager.plugins.clear();
    const order = [];
    const p1 = {priority: 1, online: jest.fn(() => {order.push('p1'); return Promise.resolve();}), offline: jest.fn(), restart: jest.fn(), state: jest.fn().mockResolvedValue(0)};
    const p2 = {priority: 3, online: jest.fn(() => {order.push('p2'); return Promise.resolve();}), offline: jest.fn(), restart: jest.fn(), state: jest.fn().mockResolvedValue(0)};
    const p3 = {priority: 2, online: jest.fn(() => {order.push('p3'); return Promise.resolve();}), offline: jest.fn(), restart: jest.fn(), state: jest.fn().mockResolvedValue(0)};
    PluginManager.plugins.set('p1', p1);
    PluginManager.plugins.set('p2', p2);
    PluginManager.plugins.set('p3', p3);
    await PluginManager.queueAllOnline();
    await new Promise(r => setTimeout(r, 1000));
    expect(order).toEqual(['p2','p3','p1']);
  });
});
