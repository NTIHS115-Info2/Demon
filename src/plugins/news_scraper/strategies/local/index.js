// src/plugins/news_scraper/strategies/local/index.js
// 職責：包含所有業務邏輯和狀態管理。
const path = require('path');
const { spawn } = require('child_process');
const Logger = require('../../../../utils/logger');
const logger = new Logger('news_scraper_local_strategy.log');

// 【狀態封裝】將狀態變量設為內部變量
let isOnline = false;
let pythonPath = 'python3'; // 預設值

/**
 * 執行 Python 腳本的核心邏輯 (私有函數)
 * @param {string} scriptName - 'scraper.py' 或 'librarian.py' 等
 * @param {string[]} args - 傳遞給腳本的參數
 * @returns {Promise<object>} - 返回解析後的 JSON 物件
 */
function _runPythonScript(scriptName, args) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, scriptName);
        const pyProcess = spawn(pythonPath, [scriptPath, ...args]);
        let stdout = '';
        let stderr = '';
        pyProcess.stdout.setEncoding('utf8');
        pyProcess.stderr.setEncoding('utf8');
        pyProcess.stdout.on('data', (data) => { stdout += data; });
        pyProcess.stderr.on('data', (data) => { stderr += data; });
        pyProcess.on('error', (err) => reject(new Error(`Python process spawn error: ${err.message}`)));
        pyProcess.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(stderr || `Python script ${scriptName} exited with code ${code}`));
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (e) {
                logger.error(`Raw stdout from ${scriptName}: ${stdout}`);
                reject(new Error(`Failed to parse JSON from ${scriptName}.`));
            }
        });
    });
}

module.exports = {
    async online(options = {}) {
        if (options.pythonPath) {
            pythonPath = options.pythonPath;
        }
        isOnline = true;
        logger.info(`Local strategy is now online with python: ${pythonPath}.`);
    },
    
    async offline() {
        isOnline = false;
        logger.info('Local strategy is now offline.');
    },

    async restart(options = {}) {
        await this.offline();
        await new Promise(resolve => setTimeout(resolve, 100));
        await this.online(options);
    },

    async state() {
        return isOnline ? 1 : 0;
    },

    async send(payload) {
        if (!isOnline) {
            return { success: false, error: 'Local strategy is offline.' };
        }
        const { url, query } = payload;
        if (!url || !query) {
            return { success: false, error: "Missing 'url' or 'query' in payload." };
        }
        try {
            const scrapedData = await _runPythonScript('scraper.py', [url]);
            if (!scrapedData.success) return scrapedData;
            const articleText = scrapedData.result.article_text;
            return await _runPythonScript('librarian.py', [articleText, query]);
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};