const composer = require('../src/core/PromptComposer');

describe('PromptComposer', () => {
  test('composeSystemPrompt 注入成功結果', async () => {
    const res = await composer.composeSystemPrompt({called:true, toolName:'mock', success:true, result:'OK'});
    expect(res).toMatch('工具 mock 已執行');
    expect(res).toMatch('結果為: OK');
  });
});
