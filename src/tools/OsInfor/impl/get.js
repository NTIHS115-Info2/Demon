const table = require('./table');
const Logger = require('../../../utils/logger');
const logger = new Logger('OsInfor');

// 定義有效的系統資訊欄位
const VALID_FIELDS = ['platform', 'arch', 'hostname', 'release', 'type'];

// 定義敏感資訊欄位（不會直接暴露給終端用戶）
const SENSITIVE_FIELDS = ['hostname'];

/**
 * 取得指定名稱的作業系統資訊
 * @param {string} name - 欲查詢的欄位名稱
 * @returns {Promise<any>} 該欄位的值，若欄位無效則回傳 null 並記錄錄日誌
 */
async function get(name) {
  // 驗證欄位名稱是否有效
  if (!VALID_FIELDS.includes(name)) {
    logger.error(`無效的系統資訊欄位: ${name}. 有效欄位: ${VALID_FIELDS.join(', ')}`);
    return null;
  }

  const info = await table();
  const value = info[name];

  // 檢查是否為敏感資訊，記錄但不暴露細節給終端
  if (SENSITIVE_FIELDS.includes(name)) {
    logger.info(`已存取敏感系統資訊欄位: ${name}`);
  }

  return value;
}

module.exports = get;
module.exports.VALID_FIELDS = VALID_FIELDS;
module.exports.SENSITIVE_FIELDS = SENSITIVE_FIELDS;
