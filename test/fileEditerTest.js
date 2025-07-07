const path = require('path');
const fs = require('fs');
const assert = require('assert');
const fileEditer = require('../src/tools/fileEditer');
const Logger = require('../src/core/logger');
const logger = new Logger('fileEditerTest');

(async () => {
  const testDir = path.join(__dirname, 'fileEditerTestDir');
  const testFile = path.join(testDir, 'test.txt');
  const testFile2 = path.join(testDir, 'test2.txt');
  try {
    // 建立測試資料夾
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);

    // 覆蓋寫入
    await fileEditer.writeFile_Cover(testFile, 'Hello');
    let content = await fileEditer.GetFileContent(testFile);
    assert.strictEqual(content, 'Hello');
    logger.info('writeFile_Cover & GetFileContent 測試通過');

    // 附加寫入
    await fileEditer.writeFile_Append(testFile, 'World');
    content = await fileEditer.GetFileContent(testFile);
    assert.strictEqual(content, 'Hello\nWorld');
    logger.info('writeFile_Append 測試通過');

    // 再建立另一個檔案
    await fileEditer.writeFile_Cover(testFile2, 'Second');
    // 讀取多檔案
    const contents = await fileEditer.GetFilesContent(testDir);
    assert(contents.includes('Hello\nWorld'));
    assert(contents.includes('Second'));
    logger.info('GetFilesContent 測試通過');

    // 檢查檔案存在
    const exists = await fileEditer.checkFile(testFile);
    assert.strictEqual(exists, true);
    logger.info('checkFile 測試通過');

    logger.info('全部 fileEditer 功能測試通過');
  } catch (err) {
    logger.error('fileEditer 測試失敗', err);
    throw err;
  } finally {
    // 清理測試檔案
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    if (fs.existsSync(testFile2)) fs.unlinkSync(testFile2);
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
  }
})();
