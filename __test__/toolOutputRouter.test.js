const { handleTool, routeOutput, ToolStreamRouter } = require('../src/core/toolOutputRouter');

// 模擬插件管理器行為
jest.mock('../src/core/pluginsManager', () => ({
  getLLMPlugin: jest.fn(),
  plugins: new Map(),
  send: jest.fn(),
}));

const PM = require('../src/core/pluginsManager');

// 每次測試前清除所有模擬狀態
beforeEach(() => {
  PM.getLLMPlugin.mockReset();
  PM.send.mockReset();
});

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

describe('toolOutputRouter Markdown 解析', () => {
  test('應移除 Markdown 包裹的工具 JSON', async () => {
    expect.assertions(3);
    try {
      // 安排：模擬插件存在並成功回應
      PM.getLLMPlugin.mockReturnValue({});
      PM.send.mockResolvedValue({});

      const res = await routeOutput('```json\n{"toolName":"fakeTool","input":{}}\n```');

      // 驗證：確保正確呼叫插件且輸出不含反引號
      expect(PM.send).toHaveBeenCalledWith('fakeTool', {});
      expect(res.handled).toBe(true);
      expect(res.content).not.toContain('```');
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});

describe('toolOutputRouter 未結束 Markdown', () => {
  test('未閉合的 Markdown 代碼區塊不應觸發工具', async () => {
    expect.assertions(5);
    try {
      PM.getLLMPlugin.mockReturnValue({});
      PM.send.mockResolvedValue({});

      const router = new ToolStreamRouter();
      let output = '';
      let handled = false;
      router.on('data', chunk => output += chunk);
      router.on('tool', msg => { handled = true; output += msg.content; });

      // 輸入未完成的 Markdown 區塊
      router.feed('```json\n{"toolName":"fakeTool","input":{}}');
      await router.flush();

      expect(handled).toBe(false);
      expect(output).toBe('');

      // 補上結束反引號後才應觸發工具
      router.feed('\n```');
      await router.flush();

      expect(handled).toBe(true);
      expect(PM.send).toHaveBeenCalledWith('fakeTool', {});
      expect(output).not.toContain('```');
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});

describe('toolOutputRouter JSON 字串包含 Markdown', () => {
  test('JSON 字串中的 ``` 不應中斷解析', async () => {
    expect.assertions(2);
    try {
      PM.getLLMPlugin.mockReturnValue({});
      PM.send.mockResolvedValue({});

      const res = await routeOutput('{"toolName":"fakeTool","input":{"text":"example ```code```"}}');

      expect(PM.send).toHaveBeenCalledWith('fakeTool', { text: 'example ```code```' });
      expect(res.handled).toBe(true);
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});

describe('toolOutputRouter 文字含三重反引號', () => {
  test('非 JSON 的 ``` 不應阻擋輸出', async () => {
    expect.assertions(2);
    try {
      const res = await routeOutput('Use ``` to start a code block.');

      expect(res.handled).toBe(false);
      expect(res.content).toBe('Use ``` to start a code block.');
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});

describe('toolOutputRouter 零散反引號後的工具 JSON', () => {
  test('文字中的 ``` 不應忽略後續工具 JSON', async () => {
    expect.assertions(2);
    try {
      PM.getLLMPlugin.mockReturnValue({});
      PM.send.mockResolvedValue({});

      const res = await routeOutput('Use ``` to start a code block.\n{"toolName":"fakeTool","input":{}}');

      expect(PM.send).toHaveBeenCalledWith('fakeTool', {});
      expect(res.handled).toBe(true);
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});

describe('toolOutputRouter 非 JSON 代碼區塊', () => {
  test('其他語言的代碼區塊不應觸發工具', async () => {
    expect.assertions(3);
    try {
      PM.getLLMPlugin.mockReturnValue({});
      PM.send.mockResolvedValue({});

      const res = await routeOutput('```javascript\nconst call = {"toolName":"fakeTool","input":{}}\n```');

      expect(PM.send).not.toHaveBeenCalled();
      expect(res.handled).toBe(false);
      expect(res.content).toBe('```javascript\nconst call = {"toolName":"fakeTool","input":{}}\n```');
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});

describe('toolOutputRouter 非工具 JSON', () => {
  test('未閉合的 JSON 代碼區塊應直接輸出', async () => {
    expect.assertions(2);
    try {
      const res = await routeOutput('```json\n{"foo":1}');

      expect(res.handled).toBe(false);
      expect(res.content).toBe('```json\n{"foo":1}');
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});
