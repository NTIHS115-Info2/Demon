const fs = require('fs');
const path = require('path');

const Logger = require('../core/logger');

const logger = new Logger('fileReader');

/**
 * 
 * @param {path} filePath 
 * @returns 
 */
// 讀取檔案內容的工具函式
async function GetFileContent(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        logger.error(`讀取檔案 ${filePath} 失敗：${err.message}`);
        return reject(err);
      }
      logger.info(`成功讀取檔案 ${filePath}`);
      resolve(data);
    });
  })
}

/**
 * 
 * @param {path} dirPath 
 * @returns 
 */
// 讀取資料夾下所有檔案的內容
async function GetFilesContent(dirPath) {
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, (err, files) => {
      if (err) {
        logger.error(`讀取資料夾 ${dirPath} 失敗：${err.message}`);
        return reject(err);
      }

      const fileReadPromises = files.map(file => {
        const fullPath = path.join(dirPath, file);
        return GetFileContent(fullPath);
      });

      Promise.all(fileReadPromises)
        .then(contents => {
          logger.info(`成功讀取資料夾 ${dirPath} 下的所有檔案`);
          resolve(contents);
        })
        .catch(err => {
          logger.error(`讀取資料夾 ${dirPath} 下的檔案失敗：${err.message}`);
          reject(err);
        });
    });
  });
}


module.exports.GetFilesContent = GetFilesContent;
module.exports.GetFileContent = GetFileContent;