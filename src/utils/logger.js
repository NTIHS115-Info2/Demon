const fs = require('fs');
const path = require('path');
const tar = require('tar');

let __baseLogPath;

let initialized = false;               // 是否已初始化
let globalLogPath = null;              // 本次啟動的 log 資料夾
let UseConsoleLog = false;              // 是否使用 console.log 輸出
const streamMap = new Map();           // 儲存每個 log 檔案名稱對應的 writeStream

const MIN_MASK_LENGTH = 6;             // 敏感資訊最小遮罩長度

// 敏感資訊過濾規則
const SENSITIVE_PATTERNS = [
  /token["\s]*[:=]["\s]*([a-zA-Z0-9._-]+)/gi,           // Token patterns
  /api[_-]?key["\s]*[:=]["\s]*([a-zA-Z0-9._-]+)/gi,    // API key patterns  
  /password["\s]*[:=]["\s]*([^\s"]+)/gi,                // Password patterns
  /secret["\s]*[:=]["\s]*([a-zA-Z0-9._-]+)/gi,          // Secret patterns
  /authorization["\s]*:["\s]*([a-zA-Z0-9._-]+)/gi,      // Authorization headers
  /bearer\s+([a-zA-Z0-9._-]+)/gi,                       // Bearer tokens
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,     // Credit card numbers
];

/**
 * 過濾敏感資訊
 * @param {string} message - 原始訊息
 * @returns {string} - 過濾後的訊息
 */
function filterSensitiveInfo(message) {
  if (typeof message !== 'string') {
    message = String(message);
  }
  
  let filteredMessage = message;
  
  SENSITIVE_PATTERNS.forEach(pattern => {
    filteredMessage = filteredMessage.replace(pattern, (match, sensitiveValue) => {
      // 如果有捕獲組，只過濾捕獲的部分
      if (sensitiveValue && typeof sensitiveValue === 'string') {
        const beforeSensitive = match.substring(0, match.indexOf(sensitiveValue));
        
        if (sensitiveValue.length <= MIN_MASK_LENGTH) {
          return beforeSensitive + '*'.repeat(sensitiveValue.length);
        }
        const visiblePart = sensitiveValue.substring(0, 3);
        const hiddenPart = '*'.repeat(sensitiveValue.length - 3);
        return beforeSensitive + visiblePart + hiddenPart;
      } else {
        // 沒有捕獲組的情況（如email和信用卡）
        if (match.length <= 6) {
          return '*'.repeat(match.length);
        }
        const visiblePart = match.substring(0, 3);  
        const hiddenPart = '*'.repeat(match.length - 3);
        return visiblePart + hiddenPart;
      }
    });
  });
  
  return filteredMessage;
}

/**
 * Logger 類別，支援多檔案記錄
 */
class Logger {
  /**
   * 建構 Logger，根據檔案名稱產生 log 寫入流
   * @param {string} logFileName - 要寫入的 log 檔名（如 main.log）
   */

  constructor(logFileName = 'default.log') {
    if (!initialized) {
      initialized = true;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      // 使用相對路徑設定 log 基底資料夾，避免依賴絕對位置
      if(!__baseLogPath) __baseLogPath = path.join('logs');
      globalLogPath = path.join(__baseLogPath, timestamp);
      fs.mkdirSync(globalLogPath, { recursive: true });

      // 壓縮上一份 log
      try {
        const entries = fs.readdirSync(__baseLogPath, { withFileTypes: true })
          .filter(e => e.isDirectory() && e.name !== path.basename(globalLogPath))
          .sort((a, b) =>
            fs.statSync(path.join(__baseLogPath, b.name)).mtimeMs -
            fs.statSync(path.join(__baseLogPath, a.name)).mtimeMs
          );

        const lastFolder = entries[0];
        if (lastFolder) {
          const lastPath = path.join(__baseLogPath, lastFolder.name);
          const archivePath = `${lastPath}.tar.gz`;

          try {
            // ✅ 壓縮上一份 log 資料夾
            tar.c({ gzip: true, file: archivePath, cwd: __baseLogPath, sync: true }, [lastFolder.name]);

            // ✅ 壓縮成功後移除原始資料夾
            fs.rmSync(lastPath, { recursive: true, force: true });

            // ✅ 壓縮檔案不保留，避免空間占用
            fs.rmSync(archivePath, { force: true });

            if (UseConsoleLog) {
              console.log(`[Logger] 已壓縮並清除上次 log：${archivePath}`);
            }
          } catch (err) {
            if (UseConsoleLog) {
              console.log(`[Logger] log 壓縮或清除失敗：${err.message}`);
            }
          }
        }
      } catch (err) {
        if(UseConsoleLog) console.warn('[Logger] 初始化期間壓縮失敗，但主流程繼續：', err.message);
      }
    } else if (!fs.existsSync(globalLogPath)) {
      // 如果資料夾被外部刪除，重新建立，確保 Logger 正常運作
      try {
        fs.mkdirSync(globalLogPath, { recursive: true });
      } catch (err) {
        if (UseConsoleLog) {
          console.warn(`[Logger] 無法重新建立 log 資料夾：${err.message}`);
        }
      }
    }

    if(!logFileName.includes('.log')){
      logFileName += '.log'; // 確保 log 檔名以 .log 結尾
    }

    // 建立 logger stream
    if (streamMap.has(logFileName)) {
      this.logStream = streamMap.get(logFileName);
    } else {
      // 以相對路徑建立 log 檔案
      const filePath = path.join(globalLogPath, logFileName);
      const stream = fs.createWriteStream(filePath, { flags: 'a' });
      streamMap.set(logFileName, stream);
      this.logStream = stream;
    }
  }

  /**
   * 格式化輸出
   * @param {string} level - INFO、WARN、ERROR
   * @param {string} message - 要輸出的訊息
   */
  format(level, message) {
    const timestamp = new Date().toISOString();
    // 過濾敏感資訊
    const filteredMessage = filterSensitiveInfo(message);
    return `${timestamp} - ${level.toUpperCase()} - ${filteredMessage}`;
  }

  Original(msg) {
    // 原始訊息輸出，過濾敏感資訊
    const filteredMsg = filterSensitiveInfo(String(msg));
    this.logStream.write(`${new Date().toISOString()} - ORIGINAL - ${filteredMsg}\n`);
    if(UseConsoleLog) console.log(filteredMsg);
  }

  /**
   * 記錄 INFO 級別訊息
   * @param {string} msg
   */
  info(msg) {
    const line = this.format('INFO', msg);
    this.logStream.write(line + '\n');
    if(UseConsoleLog) console.log(line);
  }

  /**
   * 記錄 WARN 級別訊息
   * @param {string} msg
   */
  warn(msg) {
    const line = this.format('WARN', msg);
    this.logStream.write(line + '\n');
    if(UseConsoleLog) console.warn(line);
  }

  /**
   * 記錄 ERROR 級別訊息
   * @param {string} msg
   */
  error(msg) {
    const line = this.format('ERROR', msg);
    this.logStream.write(line + '\n');
    if(UseConsoleLog) console.error(line);
  }

  /**
   * 獲取本次log的資料夾路徑
   * @returns {string} - 本次log的資料夾路徑
   */
  getLogPath() {
    return globalLogPath;
  }

  /**
   * 記錄原始訊息（不進行敏感資訊過濾）
   * 僅供調試使用，請謹慎使用
   * @param {string} level - 日誌級別
   * @param {string} msg - 訊息內容
   */
  logRaw(level, msg) {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} - ${level.toUpperCase()} - RAW - ${msg}`;
    this.logStream.write(line + '\n');
    if(UseConsoleLog) console.log(`[RAW] ${msg}`);
  }

  /**
   * 檢查訊息是否包含敏感資訊
   * @param {string} message - 要檢查的訊息
   * @returns {boolean} - 是否包含敏感資訊
   */
  static hasSensitiveInfo(message) {
    if (typeof message !== 'string') {
      message = String(message);
    }
    return SENSITIVE_PATTERNS.some(pattern => pattern.test(message));
  }

}

module.exports = Logger
module.exports.SetConsoleLog = (bool) => {
  UseConsoleLog = bool;
}
module.exports.filterSensitiveInfo = filterSensitiveInfo;