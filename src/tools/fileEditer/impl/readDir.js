const fs = require('fs');
const path = require('path');
const Logger = require('../../../utils/logger');
const { GetFileContent } = require('./readFile');

const logger = new Logger('fileEditer');

/**
 * 讀取資料夾下所有檔案的內容
 * @param {path} dirPath 
 * @returns {Promise<string[]>}
 */
async function GetFilesContent(dirPath) {
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, (err, files) => {
      if (err) {
        logger.error(`讀取資料夾 ${dirPath} 失敗：${err.message}`);
        return reject(err);
      }

      files = files.sort(); // 預設依字母排序

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
