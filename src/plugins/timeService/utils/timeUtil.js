/**
 * 時間計算相關工具函式
 * @module timeUtil
 */

/**
 * 驗證並正規化使用者輸入
 * @param {Object} options - 使用者提供的時間偏移參數
 * @returns {Object} 正規化後的選項物件
 * @throws {Error} 若輸入格式不正確
 */
function normalizeOptions(options = {}) {
  const fields = ['timezone', 'Y', 'M', 'D', 'h', 'm', 's'];
  const result = { timezone: 8, Y: 0, M: 0, D: 0, h: 0, m: 0, s: 0 };

  for (const key of fields) {
    if (options[key] !== undefined) {
      if (!Number.isInteger(options[key])) {
        throw new Error(`${key} 必須為整數`);
      }
      result[key] = options[key];
    }
  }
  return result;
}

/**
 * 根據基準 UTC 時間計算偏移後的時間字串
 * @param {Date} baseDate - 基準 UTC 時間
 * @param {Object} opts - 正規化後的時間偏移參數
 * @returns {string} 格式化後的時間字串
 */
function buildTime(baseDate, opts) {
  let time = new Date(baseDate.getTime() + opts.timezone * 3600 * 1000);

  time.setUTCFullYear(time.getUTCFullYear() + opts.Y);
  time.setUTCMonth(time.getUTCMonth() + opts.M);
  time.setUTCDate(time.getUTCDate() + opts.D);
  time.setUTCHours(time.getUTCHours() + opts.h);
  time.setUTCMinutes(time.getUTCMinutes() + opts.m);
  time.setUTCSeconds(time.getUTCSeconds() + opts.s);

  const pad = (n) => String(n).padStart(2, '0');
  const formatted = `${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())} ` +
    `${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}:${pad(time.getUTCSeconds())} (UTC+${opts.timezone})`;
  return formatted;
}

module.exports = { normalizeOptions, buildTime };
