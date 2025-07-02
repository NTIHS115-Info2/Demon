const fs = require('fs');
const path = require('path');
const tar = require('tar');

let __baseLogPath = path.resolve(__dirname, '..', '..', 'logs');

let initialized = false;                // 是否已初始化
let globalLogPath = null;              // 本次啟動的 log 資料夾
const streamMap = new Map();           // 儲存每個 log 檔案名稱對應的 writeStream

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
      globalLogPath = path.resolve(__baseLogPath, timestamp);
      fs.mkdirSync(globalLogPath, { recursive: true });

      // 壓縮上一份 log（非 await，只能 async background）
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

          // ✅ 背景壓縮，不影響主流程
          tar.c({ gzip: true, file: archivePath, cwd: __baseLogPath }, [lastFolder.name])
            .then(() => {
              fs.rmSync(lastPath, { recursive: true, force: true });
              console.log(`[Logger] 已壓縮上次 log 為：${archivePath}`);
            })
            .catch(err => {
              console.log(`[Logger] log 壓縮失敗：${err.message}`);
            });
        }
      } catch (err) {
        console.warn('[Logger] 初始化期間壓縮失敗，但主流程繼續：', err.message);
      }
    }

    // 建立 logger stream
    if (streamMap.has(logFileName)) {
      this.logStream = streamMap.get(logFileName);
    } else {
      const filePath = path.resolve(globalLogPath, logFileName);
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
    return `${timestamp} - ${level.toUpperCase()} - ${message}`;
  }

  /**
   * 記錄 INFO 級別訊息
   * @param {string} msg
   */
  info(msg) {
    const line = this.format('INFO', msg);
    this.logStream.write(line + '\n');
    console.log(line);
  }

  /**
   * 記錄 WARN 級別訊息
   * @param {string} msg
   */
  warn(msg) {
    const line = this.format('WARN', msg);
    this.logStream.write(line + '\n');
    console.warn(line);
  }

  /**
   * 記錄 ERROR 級別訊息
   * @param {string} msg
   */
  error(msg) {
    const line = this.format('ERROR', msg);
    this.logStream.write(line + '\n');
    console.error(line);
  }

  /**
   * 獲取本次log的資料夾路徑
   * @returns {string} - 本次log的資料夾路徑
   */
  getLogPath() {
    return globalLogPath;
  }

}

module.exports = Logger
module.exports.SetLoggerBasePath = (basePath) => {
  __baseLogPath = path.resolve(basePath);
};