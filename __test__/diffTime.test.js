const diffTime = require('../src/plugins/diffTime');

// 使用 Jest 提供的模擬計時器，固定系統時間以確保測試結果一致
jest.useFakeTimers().setSystemTime(new Date('2025-08-20T06:00:00Z'));

describe('diffTime 本地時間差計算', () => {
  beforeAll(async () => {
    await diffTime.online();
  });

  afterAll(async () => {
    await diffTime.offline();
    jest.useRealTimers();
  });

  test('同時提供 baseTime 與 targetTime', async () => {
    expect.assertions(1);
    try {
      const res = await diffTime.send({
        baseTime: '2025-08-23 13:00:00',
        targetTime: '2025-08-23 15:30:00'
      });
      expect(res).toEqual({ result: '00-00-00 02:30:00', resultType: 'time' });
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });

  test('僅提供 targetTime 應與現在時間比較', async () => {
    expect.assertions(1);
    try {
      const res = await diffTime.send({ targetTime: '2025-08-23 15:30:00' });
      expect(res).toEqual({ result: '00-00-03 01:30:00', resultType: 'time' });
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });

  test('僅提供 baseTime 應回傳錯誤', async () => {
    expect.assertions(1);
    try {
      const res = await diffTime.send({ baseTime: '2025-08-23 12:00:00' });
      expect(res).toEqual({ error: '缺少 targetTime' });
    } catch (e) {
      console.error('測試失敗:', e);
      throw e;
    }
  });
});
