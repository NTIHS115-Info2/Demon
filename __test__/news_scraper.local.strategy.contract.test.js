// __test__/news_scraper.local.strategy.contract.test.js
const path = require('path');
const localStrategy = require(
  path.join(process.cwd(), 'src/plugins/news_scraper/strategies/local/index.js')
);

describe('NewsScraper Local Strategy State Contract', () => {
  beforeEach(async () => {
    // 確保每個測試從離線開始，避免跨測試污染
    await localStrategy.offline();
  });

  afterAll(async () => {
    // 測試結束也回到離線，避免污染其他測試檔
    await localStrategy.offline();
  });

  test('初始狀態下，state() 應回傳 0', async () => {
      expect(await localStrategy.state()).toBe(0);
  });

  test('呼叫 online() 後，state() 應回傳 1 (在線)', async () => {
    await localStrategy.online();
    expect(await localStrategy.state()).toBe(1);
  });

  test('先 online() 再 offline()，state() 應回傳 0 (離線)', async () => {
    await localStrategy.online(); // 先確保在線
    expect(await localStrategy.state()).toBe(1); // 驗證在線
    await localStrategy.offline(); // 再下線
    expect(await localStrategy.state()).toBe(0); // 驗證下線
  });
});
