const composer = require('../src/core/PromptComposer');

describe('createToolMessage', () => {
  test('成功組合結果訊息', async () => {
    const msg = await composer.createToolMessage({called:true,toolName:'mock',success:true,result:'OK'});
    expect(msg.content).toContain('工具 mock 已執行');
    expect(msg.content).toContain('結果為: OK');
    expect(msg.role).toBe('tool');
  });

  test('失敗訊息', async () => {
    const msg = await composer.createToolMessage({called:true,toolName:'mock',success:false});
    expect(msg.content).toContain('執行失敗');
    expect(msg.role).toBe('tool');
  });
});
