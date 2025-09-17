const Logger = require('../../../utils/logger');
const cleanObject = require('../utils/cleanObject');
const logger = new Logger('jsonParser');

/**
 * 將 JSON 字串轉為整理過的物件
 * @param {string|Object} jsonData - JSON 字串或物件
 * @param {Object} [options]
 * @param {boolean} [options.removeEmpty=true] - 是否移除空值欄位
 * @param {boolean} [options.trimString=true] - 是否修剪字串首尾空白
 * @returns {Object|null} - 成功回傳物件，失敗回傳 null
 */
function parse(jsonData, options = {}) {
  const { removeEmpty = true, trimString = true } = options;

  try {
    let obj = jsonData;

    // 若輸入為字串，嘗試解析
    if (typeof jsonData === 'string') {
      obj = JSON.parse(jsonData);
    }

    // 僅允許純物件或陣列
    if (typeof obj !== 'object' || obj === null) {
      logger.error('輸入資料格式錯誤，需為 JSON 字串或物件');
      return null;
    }

    // 清理物件
    return cleanObject(obj, { removeEmpty, trimString });
  } catch (e) {
    logger.error('JSON 解析失敗: ' + e.message);
    return null;
  }
}

module.exports = parse;
