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
 * 判斷是否為閏年
 * @param {number} year - 西元年
 * @returns {boolean} 是否為閏年
 */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 修正非閏年卻出現 2 月 29 日的情況
 * @param {Date} date - 需要調整的日期物件
 */
function fixLeapDay(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  if (month === 1 && day === 29 && !isLeapYear(year)) {
    // 若目標年份非閏年，將日期回退至 2 月 28 日
    date.setUTCDate(28);
  }
}

/**
 * 根據基準 UTC 時間計算偏移後的時間字串
 * @param {Date} baseDate - 基準 UTC 時間
 * @param {Object} opts - 正規化後的時間偏移參數
 * @returns {string} 格式化後的時間字串
 */
function buildTime(baseDate, opts) {
  let time = new Date(baseDate.getTime() + opts.timezone * 3600 * 1000);

  // 記錄原始是否為閏年 2 月 29 日
  const wasFeb29 = time.getUTCMonth() === 1 && time.getUTCDate() === 29;

  // 年度偏移處理，若原為 2/29 且新年份非閏年，調整為 2/28
  time.setUTCFullYear(time.getUTCFullYear() + opts.Y);
  if (wasFeb29 && !isLeapYear(time.getUTCFullYear())) {
    time.setUTCMonth(1, 28);
  }

  time.setUTCMonth(time.getUTCMonth() + opts.M);
  time.setUTCDate(time.getUTCDate() + opts.D);
  time.setUTCHours(time.getUTCHours() + opts.h);
  time.setUTCMinutes(time.getUTCMinutes() + opts.m);
  time.setUTCSeconds(time.getUTCSeconds() + opts.s);

  // 處理閏年 2 月 29 日在非閏年的情況
  fixLeapDay(time);

  const pad = (n) => String(n).padStart(2, '0');
  const formatted = `${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())} ` +
    `${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}:${pad(time.getUTCSeconds())} (UTC+${opts.timezone})`;
  return formatted;
}

module.exports = { normalizeOptions, buildTime };
