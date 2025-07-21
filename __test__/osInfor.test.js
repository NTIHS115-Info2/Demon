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
});
