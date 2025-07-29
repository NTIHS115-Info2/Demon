// 版本 1.0 審查 - PluginsManager 核心功能測試
const PluginsManager = require('../src/core/pluginsManager');

describe('Version 1.0 PluginsManager Review', () => {
  beforeAll(async () => {
    // 清理任何先前狀態
    await PluginsManager.offlineAll();
    PluginsManager.plugins.clear();
  });

  test('PluginsManager 能載入 ASR 插件', async () => {
    await expect(PluginsManager.loadPlugin('asr')).resolves.not.toThrow();
    expect(PluginsManager.plugins.has('asr')).toBe(true);
    
    const plugin = PluginsManager.plugins.get('asr');
    expect(typeof plugin.online).toBe('function');
    expect(typeof plugin.offline).toBe('function');
    expect(typeof plugin.restart).toBe('function');
    expect(typeof plugin.state).toBe('function');
    expect(typeof plugin.updateStrategy).toBe('function');
  });

  test('PluginsManager 能載入 Discord 插件', async () => {
    await expect(PluginsManager.loadPlugin('discord')).resolves.not.toThrow();
    expect(PluginsManager.plugins.has('discord')).toBe(true);
    
    const plugin = PluginsManager.plugins.get('discord');
    expect(typeof plugin.send).toBe('function');
  });

  test('PluginsManager 能載入 LlamaServer 插件', async () => {
    await expect(PluginsManager.loadPlugin('llamaServer')).resolves.not.toThrow();
    expect(PluginsManager.plugins.has('llamaserver')).toBe(true); // 注意正規化名稱
  });

  test('PluginsManager 能載入 TTS 插件', async () => {
    await expect(PluginsManager.loadPlugin('tts')).resolves.not.toThrow();
    expect(PluginsManager.plugins.has('tts')).toBe(true);
  });

  test('PluginsManager 能載入 Ngrok 插件', async () => {
    await expect(PluginsManager.loadPlugin('ngrok')).resolves.not.toThrow();
    expect(PluginsManager.plugins.has('ngrok')).toBe(true);
  });

  test('PluginsManager 能載入 SpeechBroker 插件', async () => {
    await expect(PluginsManager.loadPlugin('speechBroker')).resolves.not.toThrow();
    expect(PluginsManager.plugins.has('speechbroker')).toBe(true); // 注意正規化名稱
  });

  test('載入不存在的插件會拋出錯誤', async () => {
    await expect(PluginsManager.loadPlugin('nonExistentPlugin')).rejects.toThrow();
  });

  test('所有已載入的插件都有 priority 屬性', () => {
    for (const [name, plugin] of PluginsManager.plugins) {
      expect(typeof plugin.priority).toBe('number');
    }
  });

  test('getPluginState 對已載入插件運作正常', async () => {
    const state = await PluginsManager.getPluginState('asr');
    expect(typeof state).toBe('number');
  });

  test('getPluginState 對未載入插件返回 -2', async () => {
    const state = await PluginsManager.getPluginState('notLoaded');
    expect(state).toBe(-2);
  });

  test('send 方法對已載入插件運作正常', async () => {
    const result = await PluginsManager.send('discord', { func: 'invalidFunc' });
    expect(typeof result).toBe('boolean');
  });

  test('send 方法對未載入插件返回 false', async () => {
    const result = await PluginsManager.send('notLoaded', {});
    expect(result).toBe(false);
  });
  
  afterAll(async () => {
    // 清理測試狀態
    await PluginsManager.offlineAll();
  });
});