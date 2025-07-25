const fs = require('fs');
const path = require('path');

const historyManager = require('../src/core/historyManager');

const userId = 'jestUser';
const filePath = path.resolve(__dirname, '..', 'history', `${userId}.json`);

describe('historyManager', () => {
  beforeEach(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await historyManager.clearHistory(userId);
  });

  test('appendMessage 與 getHistory', async () => {
    await historyManager.appendMessage(userId, 'user', 'hi');
    await historyManager.appendMessage(userId, 'assistant', 'hello');
    const hist = await historyManager.getHistory(userId, 2);
    expect(hist.length).toBe(2);
    expect(hist[0].role).toBe('user');
    expect(hist[1].role).toBe('assistant');
  });

  test('getHistory limit', async () => {
    for (let i = 0; i < 5; i++) {
      await historyManager.appendMessage(userId, 'user', 'm' + i);
    }
    const hist = await historyManager.getHistory(userId, 3);
    expect(hist.length).toBe(3);
    expect(hist[0].content).toBe('m2');
  });
});
