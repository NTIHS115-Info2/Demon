// 嚴格遵循 CommonJS 模組規範
const path = require('path');
const { spawn } = require('child_process');
const Logger = require('../../utils/logger'); // 引用 Demon OS 的核心 Logger

let strategy = null;
let currentStrategyName = 'local';
let isOnline = false;
const logger = new Logger('news_scraper.log');

function initializeStrategy(name, options = {}) {
    if (name === 'local') {
        strategy = {
            pythonPath: options.pythonPath || 'python3',
            strategyPath: path.join(__dirname, 'strategies', 'local'),

            _runPythonScript: function(scriptName, args) {
                return new Promise((resolve, reject) => {
                    const scriptPath = path.join(this.strategyPath, scriptName);
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