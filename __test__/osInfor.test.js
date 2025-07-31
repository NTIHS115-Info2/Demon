const os = require('os');
const OsInfor = require('../src/tools/OsInfor');

describe('OsInfor 工具', () => {
  test('table 應回傳完整資訊', async () => {
    const info = await OsInfor.table();
    expect(info).toHaveProperty('platform', os.platform());
    expect(info).toHaveProperty('arch', os.arch());
    expect(info).toHaveProperty('hostname');
  });

  test('get 能取得單一欄位', async () => {
    const platform = await OsInfor.get('platform');
    expect(platform).toBe(os.platform());
  });

  describe('有效欄位測試', () => {
    test('get 應能取得所有有效欄位', async () => {
      const validFields = ['platform', 'arch', 'hostname', 'release', 'type'];
      
      for (const field of validFields) {
        const value = await OsInfor.get(field);
        expect(value).toBeDefined();
        expect(value).not.toBeNull();
      }
    });

    test('getSafe 應能取得非敏感欄位', async () => {
      const platform = await OsInfor.getSafe('platform');
      expect(platform).toBe(os.platform());
    });

    test('getSafe 應對敏感欄位回傳遮罩值', async () => {
      const hostname = await OsInfor.getSafe('hostname');
      expect(hostname).toBe('***masked***');
    });
  });

  describe('無效欄位回傳行為與例外日誌', () => {
    test('get 對無效欄位應回傳 null', async () => {
      const invalidField = await OsInfor.get('invalidField');
      expect(invalidField).toBeNull();
    });

    test('getSafe 對無效欄位應回傳 null', async () => {
      const invalidField = await OsInfor.getSafe('invalidField');
      expect(invalidField).toBeNull();
    });

    test('get 對空字串欄位應回傳 null', async () => {
      const emptyField = await OsInfor.get('');
      expect(emptyField).toBeNull();
    });

    test('get 對 undefined 欄位應回傳 null', async () => {
      const undefinedField = await OsInfor.get(undefined);
      expect(undefinedField).toBeNull();
    });
  });

  describe('不輸出敏感資訊至終端用戶', () => {
    test('get 方法仍能取得完整敏感資訊（供內部使用）', async () => {
      const hostname = await OsInfor.get('hostname');
      expect(hostname).toBe(os.hostname());
      expect(hostname).not.toBe('***masked***');
    });

    test('getSafe 方法會遮罩敏感資訊（供終端用戶使用）', async () => {
      const hostname = await OsInfor.getSafe('hostname');
      expect(hostname).toBe('***masked***');
      expect(hostname).not.toBe(os.hostname());
    });
  });

  describe('快取機制測試', () => {
    test('多次呼叫 table 應回傳相同快取結果', async () => {
      const info1 = await OsInfor.table();
      const info2 = await OsInfor.table();
      
      expect(info1).toEqual(info2);
      expect(info1).toBe(info2); // 應該是同一個物件參考（快取）
    });
  });
});
