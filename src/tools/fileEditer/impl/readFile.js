const fs = require('fs');
const path = require('path');

const checkFile = require('../utils/checkFile').checkFile;

const Logger = require('../../../core/logger');

const logger = new Logger('fileEditer');

/**
 * 讀取檔案內容的工具函式
 * @param {path} filePath 
 * @returns {Promise<string>}
 */
async function GetFileContent(filePath) {
  const exists = await checkFile(filePath);
  if (!exists) {
    logger.warn(`GetFileContent: 檔案 ${filePath} 不存在`);
    return '';
  }
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        logger.error(`讀取檔案 ${filePath} 失敗：${err.message}`);
        return reject(err);
      }
      logger.info(`成功讀取檔案 ${filePath}`);
      resolve(data);
    });
  });
}

module.exports.GetFileContent = GetFileContent;

