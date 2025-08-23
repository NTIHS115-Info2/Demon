const { handleTool } = require('../src/core/toolOutputRouter');

// 模擬插件管理器行為
jest.mock('../src/core/pluginsManager', () => ({
  getLLMPlugin: jest.fn(),
  plugins: new Map(),
  send: jest.fn(),
}));

const PM = require('../src/core/pluginsManager');

describe('toolOutputRouter 插件錯誤處理', () => {
  test('插件回傳錯誤應回注 LLM', async () => {
    expect.assertions(3);
    try {
      // 安排：模擬插件存在且回傳錯誤
      PM.getLLMPlugin.mockReturnValue({});
      PM.send.mockResolvedValue({ error: 'FAIL', value: { reason: 'bad' } });

      const res = await handleTool({ toolName: 'fakeTool', input: {} });

      // 驗證：確保有呼叫 send 並回傳錯誤訊息
      expect(PM.send).toHaveBeenCalled();
      expect(res.role).toBe('tool');
      expect(res.content).toContain('FAIL');
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});
