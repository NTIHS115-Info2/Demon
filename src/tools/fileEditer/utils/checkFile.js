const fs = require('fs');
const path = require('path');

const Logger = require('../../../core/logger');
const logger = new Logger('fileEditer');

function checkFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stats) => {
      if (err) {
        if (err.code === 'ENOENT') {
          logger.warn(`檔案 ${filePath} 不存在`);
          return resolve(false);
        }
        logger.error(`檔案 ${filePath} 無法存取：${err.message}`);
        return reject(err);
      }
      if (!stats.isFile()) {
        logger.error(`路徑 ${filePath} 不是一個檔案`);
        return reject(new Error(`路徑 ${filePath} 不是一個檔案`));
      }
      logger.info(`檔案 ${filePath} 存在且可存取`);
      resolve(true);
    });
  });
}

module.exports.checkFile = checkFile;