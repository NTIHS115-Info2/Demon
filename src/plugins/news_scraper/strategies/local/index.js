const path = require('path');
const { spawn } = require('child_process');
const Logger = require('../../../../utils/logger'); // 修正路徑以匹配 Demon OS 結構

const logger = new Logger('news_scraper_local_strategy.log');

module.exports = {
    isOnline: false,
    pythonPath: 'python3', // 預設值

    /**
     * 執行 Python 腳本的核心邏輯
     * @param {string} scriptName - 'scraper.py' 或 'librarian.py'
     * @param {string[]} args - 傳遞給腳本的參數
     * @returns {Promise<object>} - 返回解析後的 JSON 物件
     */
    _runPythonScript: function(scriptName, args) {
        return new Promise((resolve, reject) => {
            // 腳本現在與此文件位於同一目錄
            const scriptPath = path.join(__dirname, scriptName);
            const pyProcess = spawn(this.pythonPath, [scriptPath, ...args]);
            let stdout = '';
            let stderr = '';

            pyProcess.stdout.setEncoding('utf8');
            pyProcess.stderr.setEncoding('utf8');
            pyProcess.stdout.on('data', (data) => { stdout += data; });
            pyProcess.stderr.on('data', (data) => { stderr += data; });
            pyProcess.on('error', (err) => reject(new Error(`Python process spawn error: ${err.message}`)));
            pyProcess.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error(stderr || `Python script exited with code ${code}`));
                }
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    logger.error(`Raw stdout from ${scriptName}: ${stdout}`);
                    reject(new Error(`Failed to parse JSON from ${scriptName}.`));
                }
            });
        });
    },

    async online(options = {}) {
        this.pythonPath = options.pythonPath || this.pythonPath;
        this.isOnline = true;
        logger.info('Local strategy is now online.');
    },

    async offline() {
        this.isOnline = false;
        logger.info('Local strategy is now offline.');
    },

    async state() {
        return this.isOnline ? 1 : 0;
    },

    async send(payload) {
        if (!this.isOnline) {
            return { success: false, error: 'Local strategy is offline.' };
        }
        const { url, query } = payload;
        if (!url || !query) {
            return { success: false, error: "Missing 'url' or 'query' in payload." };
        }
        try {
            const scrapedData = await this._runPythonScript('scraper.py', [url]);
            if (!scrapedData.success) return scrapedData;
            const articleText = scrapedData.result.article_text;
            return await this._runPythonScript('librarian.py', [articleText, query]);
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};