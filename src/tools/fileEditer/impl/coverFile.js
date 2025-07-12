const fs = require('fs');
const path = require('path');
const Logger = require('../../../utils/logger');
const checkFile = require('../utils/checkFile').checkFile;

const logger = new Logger('fileEditer');

/**
 * 寫入檔案內容的工具函式
 * @param {path} filePath
 * @param {string} contents
 * @returns {Promise<void>}
 */
async function writeFile_Cover(filePath, contents) {
    const exists = await checkFile(filePath);
    if (!exists) {
        logger.warn(`檔案 ${filePath} 不存在，將創建新檔案`);
    }
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, contents, 'utf8', (err) => {
            if (err) {
                logger.error(`寫入檔案 ${filePath} 失敗：${err.message}`);
                return reject(err);
            }
            logger.info(`成功寫入檔案 ${filePath}`);
            resolve();
        });
    });
}

module.exports.writeFile_Cover = writeFile_Cover;
