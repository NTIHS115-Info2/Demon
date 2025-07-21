const table = require('./table');

/**
 * 取得指定名稱的作業系統資訊
 * @param {string} name - 欲查詢的欄位名稱
 * @returns {Promise<any>} 該欄位的值，若不存在則回傳 undefined
 */
async function get(name) {
  const info = await table();
  return info[name];
}

module.exports = get;
