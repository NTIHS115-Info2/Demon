const fs = require('fs');
const path = require('path');
const tar = require('tar');
const config = require('../config');

function getDefaultBaseLogPath() {
  return path.resolve(__dirname, '..', '..', '..', '..', '..', 'logs');
}

class LogSession {
  constructor(options = {}) {
    this.baseLogPath = options.baseLogPath || getDefaultBaseLogPath();
    this.initialized = false;
    this.logPath = null;
  }

  ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logPath = path.resolve(this.baseLogPath, timestamp);
    fs.mkdirSync(this.logPath, { recursive: true });

    this.compressPreviousLogs();
  }

  compressPreviousLogs() {
    try {
      const entries = fs.readdirSync(this.baseLogPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== path.basename(this.logPath))
        .sort((a, b) => {
          const aTime = fs.statSync(path.join(this.baseLogPath, a.name)).mtimeMs;
          const bTime = fs.statSync(path.join(this.baseLogPath, b.name)).mtimeMs;
          return bTime - aTime;
        });

      const lastFolder = entries[0];
      if (!lastFolder) return;

      const lastPath = path.join(this.baseLogPath, lastFolder.name);
      const archivePath = `${lastPath}.tar.gz`;

      try {
        tar.c(
          { gzip: true, file: archivePath, cwd: this.baseLogPath, sync: true },
          [lastFolder.name],
        );
        fs.rmSync(lastPath, { recursive: true, force: true });
        if (config.getConsoleLog()) {
          console.log(`[Logger] 已壓縮上次 log 為：${archivePath}`);
        }
      } catch (err) {
        if (config.getConsoleLog()) {
          console.log(`[Logger] log 壓縮失敗：${err.message}`);
        }
      }
    } catch (err) {
      if (config.getConsoleLog()) {
        console.warn('[Logger] 初始化期間壓縮失敗，但主流程繼續：', err.message);
      }
    }
  }

  getLogPath() {
    this.ensureInitialized();
    return this.logPath;
  }
}

module.exports = LogSession;
