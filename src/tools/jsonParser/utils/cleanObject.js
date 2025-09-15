/**
 * 遞迴清理物件：
 * - 移除值為 null、undefined、空字串或僅含空白的欄位
 * - 字串自動修剪首尾空白
 * - 透過 options 控制功能開關
 * @param {Object|Array} data - 目標資料
 * @param {Object} options
 * @param {boolean} [options.removeEmpty=true] - 是否移除空值欄位
 * @param {boolean} [options.trimString=true] - 是否修剪字串
 * @returns {Object|Array}
 */
function cleanObject(data, options = {}) {
  const { removeEmpty = true, trimString = true } = options;

  if (Array.isArray(data)) {
    return data
      .map(item => cleanObject(item, options))
      .filter(item => !(removeEmpty && isEmptyValue(item)));
  }

  if (typeof data === 'object' && data !== null) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      const cleaned = cleanObject(value, options);
      if (removeEmpty && isEmptyValue(cleaned)) continue;
      result[key] = cleaned;
    }
    return result;
  }

  if (typeof data === 'string' && trimString) {
    return data.trim();
  }

  return data;
}

/**
 * 判斷值是否為空
 * @param {any} value
 * @returns {boolean}
 */
function isEmptyValue(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && Object.keys(value).length === 0)
  );
}

module.exports = cleanObject;
module.exports.isEmptyValue = isEmptyValue;
