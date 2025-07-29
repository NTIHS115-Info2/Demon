// 版本 1.0 審查 - TalkToDemon 核心功能測試
const TalkToDemon = require('../src/core/TalkToDemon');
const PromptComposer = require('../src/core/PromptComposer');

// Mock PluginsManager
jest.mock('../src/core/pluginsManager', () => ({
  send: jest.fn(),
  getPluginState: jest.fn().mockResolvedValue(1) // 模擬 llamaServer 已啟動
}));

describe('Version 1.0 TalkToDemon Core Review', () => {
  const PluginsManager = require('../src/core/pluginsManager');
  
  beforeEach(() => {
    jest.clearAllMocks();
    TalkToDemon.clearHistory();
  });

  test('TalkToDemon 初始狀態為 idle', () => {
    expect(TalkToDemon.getState()).toBe('idle');
  });

  test('TalkToDemon 能正確清除歷史記錄', () => {
    TalkToDemon.clearHistory();
    expect(TalkToDemon.history).toEqual([]);
  });

  test('TalkToDemon 能正確控制 gate 狀態', () => {
    TalkToDemon.closeGate();
    expect(TalkToDemon.getGateState()).toBe('close');
    
    TalkToDemon.openGate();
    expect(TalkToDemon.getGateState()).toBe('open');
  });

  test('TalkToDemon 具有必要的方法', () => {
    expect(typeof TalkToDemon.talk).toBe('function');
    expect(typeof TalkToDemon.getState).toBe('function');
    expect(typeof TalkToDemon.clearHistory).toBe('function');
    expect(typeof TalkToDemon.manualAbort).toBe('function');
    expect(typeof TalkToDemon.openGate).toBe('function');
    expect(typeof TalkToDemon.closeGate).toBe('function');
    expect(typeof TalkToDemon.getGateState).toBe('function');
  });

  test('PromptComposer 能正確獲取預設系統提示', async () => {
    const prompt = await PromptComposer.GetDefaultSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('未知領域的小惡魔');
  });

  test('TalkToDemon 有正確的初始屬性', () => {
    expect(Array.isArray(TalkToDemon.history)).toBe(true);
    expect(Array.isArray(TalkToDemon.pendingQueue)).toBe(true);
    expect(typeof TalkToDemon.processing).toBe('boolean');
    expect(typeof TalkToDemon.gateOpen).toBe('boolean');
    expect(typeof TalkToDemon.gateBuffer).toBe('string');
  });

  test('TalkToDemon manualAbort 方法不會拋出錯誤', () => {
    expect(() => TalkToDemon.manualAbort()).not.toThrow();
  });
});