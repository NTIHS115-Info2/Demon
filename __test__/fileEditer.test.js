// __test__/fileEditer.test.js

const fs = require('fs');
const path = require('path');
const fileEditer = require('../src/tools/fileEditer');

// 使用相對路徑建立測試資料夾
const TEST_DIR = path.join('__test__', 'fileEditerTestDir');
const FILE1 = path.join(TEST_DIR, 'test.txt');
const FILE2 = path.join(TEST_DIR, 'test2.txt');

describe('fileEditer 模組功能', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR);
    }
  });

  afterAll(() => {
    [FILE1, FILE2].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    if (fs.existsSync(TEST_DIR)) fs.rmdirSync(TEST_DIR);
  });

  test('writeFile_Cover & GetFileContent', async () => {
    await fileEditer.writeFile_Cover(FILE1, 'Hello');
    const c1 = await fileEditer.GetFileContent(FILE1);
    expect(c1).toBe('Hello');
  });

  test('writeFile_Append', async () => {
    await fileEditer.writeFile_Append(FILE1, 'World');
    const c2 = await fileEditer.GetFileContent(FILE1);
    expect(c2).toBe('Hello\nWorld');
  });

  test('GetFilesContent 應回傳包含所有檔案內容的陣列', async () => {
    await fileEditer.writeFile_Cover(FILE2, 'Second');
    const all = await fileEditer.GetFilesContent(TEST_DIR);
    expect(Array.isArray(all)).toBe(true);
    expect(all).toEqual(
      expect.arrayContaining([
        'Hello\nWorld',
        'Second'
      ])
    );
  });

  test('checkFile', async () => {
    const exists = await fileEditer.checkFile(FILE1);
    expect(exists).toBe(true);
  });
});
