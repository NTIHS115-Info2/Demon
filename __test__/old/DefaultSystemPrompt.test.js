// __tests__/DefaultSystemPrompt.test.js

const GetDefaultSystemPrompt = require('../../src/core/PromptComposer').GetDefaultSystemPrompt;

describe('GetDefaultSystemPrompt', () => {
  test('應回傳非空字串', async () => {
    const content = await GetDefaultSystemPrompt();
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  });
});
