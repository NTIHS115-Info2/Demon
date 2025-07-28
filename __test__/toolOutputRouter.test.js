const PM = require('../src/core/pluginsManager');
const router = require('../src/core/toolOutputRouter');

describe('toolOutputRouter', () => {
  beforeAll(() => {
    PM.plugins.set('mock', {
      send: jest.fn(async ({ text }) => text.toUpperCase()),
      pluginType: 'TOOL'
    });
    PM.llmPlugins.set('mock', PM.plugins.get('mock'));
  });

  test('解析正確 JSON 並注入回 LLM', async () => {
    const output = JSON.stringify({ toolName: 'mock', text: 'hi' });
    const res = await router.routeOutput(output, { emitWaiting: () => {}, timeout: 500 });
    expect(res.handled).toBe(true);
    expect(res.content).toContain('結果為: HI');
  });

  test('錯誤格式應當回傳原訊息', async () => {
    const res = await router.routeOutput('not json');
    expect(res.handled).toBe(false);
    expect(res.content).toBe('not json');
  });

  test('工具失敗時注入失敗狀態', async () => {
    PM.plugins.get('mock').send.mockRejectedValueOnce(new Error('fail'));
    const output = JSON.stringify({ toolName: 'mock', text: 'hi' });
    const res = await router.routeOutput(output, { emitWaiting: () => {} });
    expect(res.handled).toBe(true);
    expect(res.content).toContain('執行失敗');
  });

  test('工具逾時處理', async () => {
    PM.plugins.get('mock').send.mockImplementationOnce(() => new Promise(r => setTimeout(() => r('OK'), 2000)));
    const output = JSON.stringify({ toolName: 'mock', text: 'hi' });
    const res = await router.routeOutput(output, { emitWaiting: () => {}, timeout: 100 });
    expect(res.handled).toBe(true);
    expect(res.content).toContain('執行失敗');
  });

  test('findToolJSON 可於自然語言中擷取 JSON', () => {
    const text = 'hello ' + JSON.stringify({ toolName: 'mock', text: 'hi' }) + ' world';
    const found = router.findToolJSON(text);
    expect(found.data.toolName).toBe('mock');
    expect(text.slice(0, found.start)).toBe('hello ');
  });
});
