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

  test('解析正確 JSON 並回傳結果給使用者', async () => {
    const output = JSON.stringify({ toolName: 'mock', result: 'hi', toolResultTarget: 'user', text: 'hi' });
    const res = await router.routeOutput(output, { setBusy: () => {} });
    expect(res.handled).toBe(true);
    expect(res.target).toBe('user');
    expect(res.content).toBe('HI');
  });

  test('插件回傳錯誤時導向 LLM', async () => {
    PM.plugins.get('mock').send.mockImplementationOnce(async () => { throw new Error('fail'); });
    const output = JSON.stringify({ toolName: 'mock', toolResultTarget: 'llm', text: 'hi' });
    const res = await router.routeOutput(output, { setBusy: () => {} });
    expect(res.handled).toBe(true);
    expect(res.target).toBe('llm');
    expect(res.content).toMatch('執行失敗');
  });

  test('工具逾時應回報失敗', async () => {
    PM.plugins.get('mock').send.mockImplementationOnce(async () => new Promise(resolve => setTimeout(() => resolve('OK'), 2000)));
    const output = JSON.stringify({ toolName: 'mock', toolResultTarget: 'llm', text: 'hi' });
    const res = await router.routeOutput(output, { setBusy: () => {}, timeout: 500 });
    expect(res.handled).toBe(true);
    expect(res.target).toBe('llm');
    expect(res.content).toMatch('失敗');
  });

  test('錯誤格式應當回傳原訊息', async () => {
    const res = await router.routeOutput('not json');
    expect(res.handled).toBe(false);
    expect(res.content).toBe('not json');
  });
});
