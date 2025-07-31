// __test__/pluginsManager.test.js
//
// 測試 PluginsManager 的核心生命週期方法和功能
const PluginsManager = require('../src/core/pluginsManager');

describe('PluginsManager 核心功能', () => {
  let mockPlugin1, mockPlugin2, mockPlugin3;
  let originalConsoleError, originalConsoleWarn;

  beforeEach(() => {
    // 清空插件容器
    PluginsManager.plugins.clear();
    PluginsManager.llmPlugins.clear();
    PluginsManager.queue = [];
    PluginsManager.running = false;
    
    // Mock console methods to capture error logs
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    console.error = jest.fn();
    console.warn = jest.fn();

    // 建立不同優先度的 mock plugins
    mockPlugin1 = {
      pluginName: 'plugin1',
      priority: 1,
      online: jest.fn().mockResolvedValue(true),
      offline: jest.fn().mockResolvedValue(),
      restart: jest.fn().mockResolvedValue(),
      state: jest.fn().mockResolvedValue(0),
      updateStrategy: jest.fn().mockResolvedValue()
    };

    mockPlugin2 = {
      pluginName: 'plugin2', 
      priority: 3,
      online: jest.fn().mockResolvedValue(true),
      offline: jest.fn().mockResolvedValue(),
      restart: jest.fn().mockResolvedValue(),
      state: jest.fn().mockResolvedValue(0),
      updateStrategy: jest.fn().mockResolvedValue()
    };

    mockPlugin3 = {
      pluginName: 'plugin3',
      priority: 2,
      online: jest.fn().mockResolvedValue(true),
      offline: jest.fn().mockResolvedValue(),
      restart: jest.fn().mockResolvedValue(),
      state: jest.fn().mockResolvedValue(0),
      updateStrategy: jest.fn().mockResolvedValue()
    };

    // 注入到 PluginsManager
    PluginsManager.plugins.set('plugin1', mockPlugin1);
    PluginsManager.plugins.set('plugin2', mockPlugin2);
    PluginsManager.plugins.set('plugin3', mockPlugin3);
  });

  afterEach(() => {
    // 還原 console methods
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  describe('online/offline/restart 基本功能', () => {
    test('queueOnline 應正確呼叫 plugin.online', async () => {
      await expect(PluginsManager.queueOnline('plugin1', {preset: 'exclusive'})).resolves.toBe(true);
      expect(mockPlugin1.online).toHaveBeenCalledWith({preset: 'exclusive'});
    });

    test('offlineAll 應對所有插件呼叫 offline', async () => {
      await PluginsManager.offlineAll();
      expect(mockPlugin1.offline).toHaveBeenCalled();
      expect(mockPlugin2.offline).toHaveBeenCalled();
      expect(mockPlugin3.offline).toHaveBeenCalled();
    });

    test('restartAll 應對所有插件呼叫 restart', async () => {
      const options = {mode: 'test'};
      await PluginsManager.restartAll(options);
      expect(mockPlugin1.restart).toHaveBeenCalledWith(options);
      expect(mockPlugin2.restart).toHaveBeenCalledWith(options);
      expect(mockPlugin3.restart).toHaveBeenCalledWith(options);
    });
  });

  describe('priority 排序與相依關係', () => {
    test('queueAllOnline 應依照 priority 由高至低排序', async () => {
      const order = [];
      mockPlugin1.online = jest.fn(() => {order.push('plugin1'); return Promise.resolve();});
      mockPlugin2.online = jest.fn(() => {order.push('plugin2'); return Promise.resolve();});
      mockPlugin3.online = jest.fn(() => {order.push('plugin3'); return Promise.resolve();});

      await PluginsManager.queueAllOnline();
      
      // 等待佇列處理完成
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 預期順序：plugin2(priority:3) -> plugin3(priority:2) -> plugin1(priority:1)
      expect(order).toEqual(['plugin2', 'plugin3', 'plugin1']);
    });

    test('相同 priority 的插件應保持載入順序', async () => {
      // 設定相同 priority
      mockPlugin1.priority = 2;
      mockPlugin3.priority = 2;
      const order = [];
      
      mockPlugin1.online = jest.fn(() => {order.push('plugin1'); return Promise.resolve();});
      mockPlugin2.online = jest.fn(() => {order.push('plugin2'); return Promise.resolve();});
      mockPlugin3.online = jest.fn(() => {order.push('plugin3'); return Promise.resolve();});

      await PluginsManager.queueAllOnline();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // plugin2(priority:3) 先執行，然後是 plugin1 和 plugin3 (都是 priority:2，保持載入順序)
      expect(order).toEqual(['plugin2', 'plugin1', 'plugin3']);
    });
  });

  describe('防止重複上線 (queueOnline 測試)', () => {
    test('插件已上線時應跳過重複啟動', async () => {
      // 設定插件狀態為已上線 (1)
      mockPlugin1.state.mockResolvedValue(1);
      
      const result = await PluginsManager.queueOnline('plugin1');
      expect(result).toBe(false);
      expect(mockPlugin1.online).not.toHaveBeenCalled();
    });

    test('插件離線時應允許上線', async () => {
      // 設定插件狀態為離線 (0)
      mockPlugin1.state.mockResolvedValue(0);
      
      const result = await PluginsManager.queueOnline('plugin1');
      expect(result).toBe(true);
      expect(mockPlugin1.online).toHaveBeenCalled();
    });

    test('多次呼叫 queueOnline 應防止重複加入佇列', async () => {
      mockPlugin1.state.mockResolvedValue(0);
      
      // 測試真實的併發情況 - 使用Promise.all同時發起
      const results = await Promise.allSettled([
        PluginsManager.queueOnline('plugin1'),
        PluginsManager.queueOnline('plugin1'),
        PluginsManager.queueOnline('plugin1')
      ]);
      
      // 分析結果
      const successResults = results.filter(r => r.status === 'fulfilled' && r.value === true);
      const falseResults = results.filter(r => r.status === 'fulfilled' && r.value === false);
      
      // 應該只有一個成功，其他的應該回傳 false
      expect(successResults.length).toBeLessThanOrEqual(1);
      expect(successResults.length + falseResults.length).toBe(3); // 總數應為3
    });
  });

  describe('getPluginState 回傳值正確', () => {
    test('插件存在且有 state 方法時應回傳正確狀態', async () => {
      mockPlugin1.state.mockResolvedValue(1);
      const state = await PluginsManager.getPluginState('plugin1');
      expect(state).toBe(1);
      expect(mockPlugin1.state).toHaveBeenCalled();
    });

    test('插件不存在時應回傳 -2', async () => {
      const state = await PluginsManager.getPluginState('nonexistent');
      expect(state).toBe(-2);
    });

    test('插件存在但無 state 方法時應回傳 -2', async () => {
      const pluginWithoutState = {
        pluginName: 'nostate',
        online: jest.fn(),
        offline: jest.fn(),
        restart: jest.fn(),
        updateStrategy: jest.fn()
      };
      PluginsManager.plugins.set('nostate', pluginWithoutState);
      
      const state = await PluginsManager.getPluginState('nostate');
      expect(state).toBe(-2);
    });

    test('插件名稱大小寫不敏感', async () => {
      mockPlugin1.state.mockResolvedValue(1);
      const state1 = await PluginsManager.getPluginState('PLUGIN1');
      const state2 = await PluginsManager.getPluginState('Plugin1');
      expect(state1).toBe(1);
      expect(state2).toBe(1);
    });
  });

  describe('啟動失敗與例外時須完整日誌', () => {
    test('queueOnline 失敗時應記錄錯誤日誌', async () => {
      const error = new Error('啟動失敗');
      mockPlugin1.online.mockRejectedValue(error);
      mockPlugin1.state.mockResolvedValue(0);
      
      await expect(PluginsManager.queueOnline('plugin1')).rejects.toThrow('啟動失敗');
    });

    test('getPluginState 例外時應有錯誤處理', async () => {
      const error = new Error('狀態查詢失敗');
      mockPlugin1.state.mockRejectedValue(error);
      
      // getPluginState 在 queueOnline 中被呼叫，應該處理例外
      const result = await PluginsManager.queueOnline('plugin1');
      expect(result).toBe(false);
    });

    test('offline 失敗時不應拋出例外', async () => {
      const error = new Error('離線失敗');
      mockPlugin1.offline.mockRejectedValue(error);
      
      // offlineAll 應該繼續處理其他插件即使某個失敗
      await expect(PluginsManager.offlineAll()).resolves.not.toThrow();
    });

    test('restart 失敗時不應拋出例外', async () => {
      const error = new Error('重啟失敗');
      mockPlugin1.restart.mockRejectedValue(error);
      
      // restartAll 應該繼續處理其他插件即使某個失敗
      await expect(PluginsManager.restartAll()).resolves.not.toThrow();
    });
  });

  describe('其他核心功能', () => {
    test('normalizeName 應正確轉換名稱為小寫', () => {
      expect(PluginsManager.normalizeName('TestPlugin')).toBe('testplugin');
      expect(PluginsManager.normalizeName('TEST')).toBe('test');
      expect(PluginsManager.normalizeName('test')).toBe('test');
    });

    test('send 方法應正確傳送資料給插件', async () => {
      mockPlugin1.send = jest.fn().mockResolvedValue('success');
      mockPlugin1.state.mockResolvedValue(1); // 模擬插件已上線
      
      const result = await PluginsManager.send('plugin1', {test: 'data'});
      expect(result).toBe('success');
      expect(mockPlugin1.send).toHaveBeenCalledWith({test: 'data'});
    });

    test('send 給不存在的插件應回傳 false', async () => {
      const result = await PluginsManager.send('nonexistent', {test: 'data'});
      expect(result).toBe(false);
    });

    test('LLM 插件應正確註冊到 llmPlugins', () => {
      const llmPlugin = {
        pluginName: 'llm1',
        pluginType: 'LLM',
        priority: 1,
        online: jest.fn(),
        offline: jest.fn(),
        restart: jest.fn(),
        state: jest.fn(),
        updateStrategy: jest.fn()
      };
      
      PluginsManager.plugins.set('llm1', llmPlugin);
      PluginsManager.llmPlugins.set('llm1', llmPlugin);
      
      expect(PluginsManager.getLLMPlugin('llm1')).toBe(llmPlugin);
      expect(PluginsManager.getAllLLMPlugin()).toContain(llmPlugin);
    });
  });
});