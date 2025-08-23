/**
 * 時間計算相關工具函式
 * @module timeUtil
 */

// 驗證時間字串的正規表達式
const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * 驗證並正規化使用者輸入
 * @param {Object} options - 使用者提供的時間偏移與時間點參數
 * @returns {Object} 正規化後的選項物件
 * @throws {Error} 若輸入格式不正確
 */
function normalizeOptions(options = {}) {
  const fields = ['timezone', 'Y', 'M', 'D', 'h', 'm', 's'];
  const result = {
    timezone: 8,
    Y: 0,
    M: 0,
    D: 0,
    h: 0,
    m: 0,
    s: 0,
    baseTime: undefined,
    targetTime: undefined
  };

  for (const key of fields) {
    if (options[key] !== undefined) {
      if (!Number.isInteger(options[key])) {
        throw new Error(`${key} 必須為整數`);
      }
      result[key] = options[key];
    }
  }

  // baseTime 與 targetTime 為可選字串
  if (options.baseTime !== undefined) {
    if (typeof options.baseTime !== 'string' || !TIME_RE.test(options.baseTime)) {
      throw new Error('baseTime 格式錯誤，需為 YYYY-MM-DD hh:mm:ss');
    }
    result.baseTime = options.baseTime;
  }

  if (options.targetTime !== undefined) {
    if (typeof options.targetTime !== 'string' || !TIME_RE.test(options.targetTime)) {
      throw new Error('targetTime 格式錯誤，需為 YYYY-MM-DD hh:mm:ss');
    }
    result.targetTime = options.targetTime;
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
 * 取得指定年月的天數
 * @param {number} year - 西元年
 * @param {number} month - 0 開始的月份
 * @returns {number} 該月天數
 */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
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
 * 解析時間字串為 UTC Date
 * @param {string} str - "YYYY-MM-DD hh:mm:ss" 格式時間字串
 * @param {number} timezone - 時區偏移量
 * @returns {Date} 對應的 UTC Date 物件
 */
function parseTimeString(str, timezone) {
  const m = str.match(TIME_RE);
  if (!m) throw new Error('時間字串格式錯誤');
  const [year, month, day, hour, minute, second] = str
    .split(/[- :]/)
    .map((v) => parseInt(v, 10));
  // 將當地時間轉換為 UTC 時間
  return new Date(Date.UTC(year, month - 1, day, hour - timezone, minute, second));
}

/**
 * 套用偏移量於基準時間
 * @param {Date} baseUTC - 基準 UTC 時間
 * @param {Object} opts - 正規化後的偏移選項
 * @returns {Date} 套用偏移後的 UTC 時間
 */
function applyOffset(baseUTC, opts) {
  // 先轉換成目標時區的當地時間
  let time = new Date(baseUTC.getTime() + opts.timezone * 3600 * 1000);

  // 記錄是否為 2/29
  const wasFeb29 = time.getUTCMonth() === 1 && time.getUTCDate() === 29;

  // 依序套用偏移量（確保跨月跨年邏輯正確）
  time.setUTCFullYear(time.getUTCFullYear() + opts.Y);
  if (wasFeb29 && !isLeapYear(time.getUTCFullYear())) {
    time.setUTCMonth(1, 28);
  }
  time.setUTCMonth(time.getUTCMonth() + opts.M);
  time.setUTCDate(time.getUTCDate() + opts.D);
  time.setUTCHours(time.getUTCHours() + opts.h);
  time.setUTCMinutes(time.getUTCMinutes() + opts.m);
  time.setUTCSeconds(time.getUTCSeconds() + opts.s);

  // 處理非閏年 2/29
  fixLeapDay(time);

  // 轉回 UTC 時間
  return new Date(time.getTime() - opts.timezone * 3600 * 1000);
}

/**
 * 將 UTC 時間格式化為指定時區的字串
 * @param {Date} utcDate - UTC 時間
 * @param {number} timezone - 時區偏移量
 * @returns {string} 格式化後的時間字串
 */
function formatTime(utcDate, timezone) {
  const time = new Date(utcDate.getTime() + timezone * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())} ` +
    `${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}:${pad(time.getUTCSeconds())} (UTC+${timezone})`
  );
}

/**
 * 計算兩個 UTC 時間的差距
 * @param {Date} baseUTC - 基準時間
 * @param {Date} targetUTC - 目標時間
 * @returns {{ formatted: string, seconds: number }} 差距字串與秒數
 */
function diffTime(baseUTC, targetUTC) {
  let start = baseUTC;
  let end = targetUTC;
  let sign = 1;
  if (targetUTC.getTime() < baseUTC.getTime()) {
    start = targetUTC;
    end = baseUTC;
    sign = -1;
  }

  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let months = end.getUTCMonth() - start.getUTCMonth();
  if (months < 0) {
    years--;
    months += 12;
  }

  let days = end.getUTCDate() - start.getUTCDate();
  if (days < 0) {
    months--;
    const prevMonth = (end.getUTCMonth() - 1 + 12) % 12;
    const prevYear = prevMonth === 11 ? end.getUTCFullYear() - 1 : end.getUTCFullYear();
    days += daysInMonth(prevYear, prevMonth);
    if (months < 0) {
      years--;
      months += 12;
    }
  }

  let hours = end.getUTCHours() - start.getUTCHours();
  if (hours < 0) {
    days--;
    hours += 24;
    if (days < 0) {
      months--;
      const prevMonth = (end.getUTCMonth() - 1 + 12) % 12;
      const prevYear = prevMonth === 11 ? end.getUTCFullYear() - 1 : end.getUTCFullYear();
      days += daysInMonth(prevYear, prevMonth);
      if (months < 0) {
        years--;
        months += 12;
      }
    }
  }

  let minutes = end.getUTCMinutes() - start.getUTCMinutes();
  if (minutes < 0) {
    hours--;
    minutes += 60;
    if (hours < 0) {
      days--;
      hours += 24;
      if (days < 0) {
        months--;
        const prevMonth = (end.getUTCMonth() - 1 + 12) % 12;
        const prevYear = prevMonth === 11 ? end.getUTCFullYear() - 1 : end.getUTCFullYear();
        days += daysInMonth(prevYear, prevMonth);
        if (months < 0) {
          years--;
          months += 12;
        }
      }
    }
  }

  let seconds = end.getUTCSeconds() - start.getUTCSeconds();
  if (seconds < 0) {
    minutes--;
    seconds += 60;
    if (minutes < 0) {
      hours--;
      minutes += 60;
      if (hours < 0) {
        days--;
        hours += 24;
        if (days < 0) {
          months--;
          const prevMonth = (end.getUTCMonth() - 1 + 12) % 12;
          const prevYear = prevMonth === 11 ? end.getUTCFullYear() - 1 : end.getUTCFullYear();
          days += daysInMonth(prevYear, prevMonth);
          if (months < 0) {
            years--;
            months += 12;
          }
        }
      }
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const formatted = `${sign < 0 ? '-' : ''}${pad(years)}-${pad(months)}-${pad(days)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  const diffSeconds = sign * Math.floor((end.getTime() - start.getTime()) / 1000);
  return { formatted, seconds: diffSeconds };
}

module.exports = {
  normalizeOptions,
  parseTimeString,
  applyOffset,
  formatTime,
  diffTime
};
