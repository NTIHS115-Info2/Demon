const os = require('os');
const Logger = require('../../../utils/logger');
const logger = new Logger('OsInfor');

// 快取查詢結果以減少重複呼叫
let cachedInfo = null;

/**
 * 取得完整的作業系統資訊表
 * 若已經查詢過，會直接回傳快取資料
 * @returns {Promise<object>} 包含平台、架構、主機名稱等資料
 */
async function table() {
  if (cachedInfo) {
    return cachedInfo;
  }

  try {
    cachedInfo = {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      release: os.release(),
      type: os.type()
    };
    return cachedInfo;
  } catch (e) {
    logger.error('取得 OS 資訊失敗: ' + e.message);
    throw e;
  }
}

module.exports = table;
