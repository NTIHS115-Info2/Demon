const table = require('./table');
const Logger = require('../../../utils/logger');
const logger = new Logger('OsInfor');

// 從 get.js 引入常數
const { VALID_FIELDS, SENSITIVE_FIELDS } = require('./get');

/**
 * 取得指定名稱的作業系統資訊（安全版本，過濾敏感資訊）
 * 適用於終端用戶顯示，不會暴露敏感資訊如主機名稱
 * @param {string} name - 欲查詢的欄位名稱
 * @returns {Promise<any>} 該欄位的值，敏感欄位會回傳遮罩值，無效欄位回傳 null
 */
async function getSafe(name) {
  // 驗證欄位名稱是否有效
  if (!VALID_FIELDS.includes(name)) {
    logger.error(`無效的系統資訊欄位: ${name}. 有效欄位: ${VALID_FIELDS.join(', ')}`);
    return null;
  }

  const info = await table();
  const value = info[name];

  // 檢查是否為敏感資訊，回傳遮罩值
  if (SENSITIVE_FIELDS.includes(name)) {
    logger.info(`終端用戶嘗試存取敏感欄位 ${name}，已遮罩處理`);
    return '***masked***';
  }

  return value;
}

module.exports = getSafe;