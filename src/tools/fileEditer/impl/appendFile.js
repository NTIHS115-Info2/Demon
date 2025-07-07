const fs = require('fs');
const path = require('path');
const Logger = require('../../../core/logger');
const checkFile = require('../utils/checkFile').checkFile;
const GetFileContent = require('./readFile').GetFileContent;

const logger = new Logger('fileEditer');

/**
 * 寫入檔案內容的工具函式
 * @param {path} filePath
 * @param {string} contents
 * @returns {Promise<void>}
 */
async function writeFile_Append(filePath, contents) {
    const exists = await checkFile(filePath);
    if (!exists) {
        logger.warn(`檔案 ${filePath} 不存在，將創建新檔案`);
    }

    let originalContent = '';
    if (exists) {
        originalContent = await GetFileContent(filePath).catch(err => {
            logger.error(`讀取檔案 ${filePath} 失敗：${err.message}`);
            throw err;
        });
    }
    const newContent = exists ? `${originalContent}\n${contents}` : contents;
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, newContent, 'utf8', (err) => {
            if (err) {
                logger.error(`寫入檔案 ${filePath} 失敗：${err.message}`);
                return reject(err);
            }
            logger.info(`成功寫入檔案 ${filePath}`);
            resolve();
        });
    });
}

module.exports.writeFile_Append = writeFile_Append;
