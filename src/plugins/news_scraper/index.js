// 嚴格遵循 CommonJS 模組規範
const path = require('path');
const { spawn } = require('child_process');
const Logger = require('../../utils/logger'); // 引用 Demon OS 的核心 Logger

// 模組級別變數，用於保存策略實例和狀態
let strategy = null;
let currentStrategyName = 'local'; // 根據分支的現狀，我們從 local 開始
let isOnline = false;
const logger = new Logger('news_scraper.log');

/**
 * 內部函數，用於初始化策略實例
 * @param {string} name - 策略名稱 ('local')
 * @param {object} options - 傳遞給策略的選項
 */
function initializeStrategy(name, options = {}) {
    if (name === 'local') {
        strategy = {
            pythonPath: options.pythonPath || 'python3', // 應使用更明確的 python3
            strategyPath: path.join(__dirname, 'strategies', 'local'),

            /**
             * 執行 Python 腳本的核心邏輯
             * @param {string} scriptName - 'scraper.py' 或 'librarian.py'
             * @param {string[]} args - 傳遞給腳本的參數
             * @returns {Promise<object>} - 返回解析後的 JSON 物件
             */
            _runPythonScript: function(scriptName, args) {
                return new Promise((resolve, reject) => {
                    const scriptPath = path.join(this.strategyPath, scriptName);
                    const pyProcess = spawn(this.pythonPath, [scriptPath, ...args]);
                    let stdout = '';
                    let stderr = '';

                    // [教訓 2.1] 嚴格使用 utf8 編碼處理 stdout，避免亂碼
                    pyProcess.stdout.setEncoding('utf8');
                    pyProcess.stderr.setEncoding('utf8');

                    pyProcess.stdout.on('data', (data) => { stdout += data; });
                    pyProcess.stderr.on('data', (data) => { stderr += data; });

                    // [教訓 2.5] 增加對 error 事件的監聽，捕獲生成失敗
                    pyProcess.on('error', (err) => {
                        logger.error(`Python process for ${scriptName} could not be spawned: ${err.message}`);
                        return reject(new Error(`Python process spawn error: ${err.message}`));
                    });

                    pyProcess.on('close', (code) => {
                        if (code !== 0) {
                            logger.error(`Python script ${scriptName} exited with code ${code}: ${stderr}`);
                            return reject(new Error(stderr || `Python script exited with code ${code}`));
                        }
                        try {
                            const result = JSON.parse(stdout);
                            resolve(result);
                        } catch (e) {
                            logger.error(`Failed to parse JSON from Python script ${scriptName}: ${e.message}`);
                            logger.error(`Raw stdout from Python: ${stdout}`);
                            reject(new Error('Failed to parse JSON from Python script.'));
                        }
                    });
                });
            },

            /**
             * 策略的 send 方法，協調 scraper 和 librarian
             * @param {object} payload - 包含 url 和 query 的任務物件
             * @returns {Promise<object>}
             */
            send: async function(payload) {
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
        logger.info(`Strategy '${name}' initialized.`);
    } else {
        throw new Error(`Strategy '${name}' not found.`);
    }
}

// 導出符合 regulation.md 規範的純物件
module.exports = {
    // init 函數為 regulation.md 中隱含的要求，pluginsManager 可能會調用
    async init(options = {}) {
        logger.info('news_scraper_plugin initializing...');
        initializeStrategy(currentStrategyName, options);
    },
    async updateStrategy(options = {}) {
        await this.restart(options);
    },
    async online(options = {}) {
        if (!strategy) initializeStrategy(currentStrategyName, options);
        isOnline = true;
        logger.info('news_scraper_plugin is now online.');
    },
    async offline() {
        isOnline = false;
        logger.info('news_scraper_plugin is now offline.');
    },
    async restart(options = {}) {
        await this.offline();
        await new Promise(resolve => setTimeout(resolve, 100));
        currentStrategyName = options.strategy || 'local';
        await this.online(options);
    },
    async state() {
        return isOnline ? 1 : 0;
    },
    async send(payload) {
        if (!isOnline) return { success: false, error: 'Plugin is offline.' };
        return strategy.send(payload);
    }
};