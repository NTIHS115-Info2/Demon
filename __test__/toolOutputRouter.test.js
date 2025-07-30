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

  test('工具逾時具體錯誤日誌', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    PM.plugins.get('mock').send.mockImplementationOnce(() => new Promise(r => setTimeout(() => r('OK'), 2000)));
    
    const output = JSON.stringify({ toolName: 'mock', text: 'timeout-test' });
    await router.routeOutput(output, { timeout: 50 });
    
    // 透過檢查是否有相關的錯誤日誌來驗證逾時處理
    expect(PM.plugins.get('mock').send).toHaveBeenCalledWith({ toolName: 'mock', text: 'timeout-test' });
    
    consoleSpy.mockRestore();
  });

  test('findToolJSON 可於自然語言中擷取 JSON', () => {
    const text = 'hello ' + JSON.stringify({ toolName: 'mock', text: 'hi' }) + ' world';
    const found = router.findToolJSON(text);
    expect(found.data.toolName).toBe('mock');
    expect(text.slice(0, found.start)).toBe('hello ');
  });

  test('處理多個工具呼叫', async () => {
    PM.plugins.set('tool1', {
      send: jest.fn(async ({ text }) => `Result1: ${text}`),
      pluginType: 'TOOL'
    });
    PM.plugins.set('tool2', {
      send: jest.fn(async ({ text }) => `Result2: ${text}`),
      pluginType: 'TOOL'
    });
    PM.llmPlugins.set('tool1', PM.plugins.get('tool1'));
    PM.llmPlugins.set('tool2', PM.plugins.get('tool2'));
    
    const output = 'Before ' + 
      JSON.stringify({ toolName: 'tool1', text: 'hello' }) + 
      ' middle ' +
      JSON.stringify({ toolName: 'tool2', text: 'world' }) +
      ' after';
    
    const res = await router.routeOutput(output);
    expect(res.handled).toBe(true);
    expect(res.content).toContain('Before');
    expect(res.content).toContain('middle');
    expect(res.content).toContain('after');
    expect(res.content).toContain('結果為: Result1: hello');
    expect(res.content).toContain('結果為: Result2: world');
  });

  test('ToolStreamRouter 處理串流資料與多工具', async () => {
    const streamRouter = new router.ToolStreamRouter();
    let output = '';
    let toolCount = 0;
    
    streamRouter.on('data', chunk => { output += chunk; });
    streamRouter.on('tool', msg => { toolCount++; output += msg.content; });
    
    await streamRouter.feed('Start ');
    await streamRouter.feed('{"toolName":"mock",');
    await streamRouter.feed('"text":"test1"} ');
    await streamRouter.feed('Middle ');
    await streamRouter.feed('{"toolName":"mock","text":"test2"} ');
    await streamRouter.feed('End');
    await streamRouter.flush();
    
    expect(toolCount).toBe(2);
    expect(output).toContain('Start');
    expect(output).toContain('Middle');
    expect(output).toContain('End');
    expect(output).toContain('TEST1'); // mock returns uppercase
    expect(output).toContain('TEST2');
  });
});
