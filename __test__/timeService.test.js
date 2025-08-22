const timeService = require('../src/plugins/timeService');

// 使用 Jest 提供的模擬計時器，固定系統時間以確保測試結果一致
jest.useFakeTimers().setSystemTime(new Date('2025-08-20T06:00:00Z'));

describe('timeService 本地時間計算', () => {
  // 測試開始前先啟動插件
  beforeAll(async () => {
    await timeService.online();
  });

  // 測試結束後關閉插件並恢復計時器
  afterAll(async () => {
    await timeService.offline();
    jest.useRealTimers();
  });

  test('預設時區 +8，偏移 +1 小時', async () => {
    expect.assertions(1);
    try {
      const res = await timeService.send({ h: 1 });
      expect(res).toEqual({ result: '2025-08-20 15:00:00 (UTC+8)' });
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });

  test('指定時區 +9，偏移 +1 天 2 小時', async () => {
    expect.assertions(1);
    try {
      const res = await timeService.send({ timezone: 9, D: 1, h: 2 });
      expect(res).toEqual({ result: '2025-08-21 17:00:00 (UTC+9)' });
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });

  test('偏移 -2 天 -5 分', async () => {
    expect.assertions(1);
    try {
      const res = await timeService.send({ D: -2, m: -5 });
      expect(res).toEqual({ result: '2025-08-18 13:55:00 (UTC+8)' });
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });

  test('閏年 2 月 29 日加一年應為 2 月 28 日', async () => {
    expect.assertions(1);
    try {
      // 將系統時間設定為閏年 2024-02-29
      jest.setSystemTime(new Date('2024-02-29T00:00:00Z'));
      const res = await timeService.send({ Y: 1 });
      expect(res).toEqual({ result: '2025-02-28 08:00:00 (UTC+8)' });
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    } finally {
      // 測試完成後恢復原始基準時間
      jest.setSystemTime(new Date('2025-08-20T06:00:00Z'));
    }
  });

  test('非整數輸入應回傳錯誤', async () => {
    expect.assertions(1);
    try {
      const res = await timeService.send({ timezone: 8.5 });
      expect(res).toEqual({ error: 'timezone 必須為整數' });
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});
