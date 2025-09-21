// src/plugins/news_scraper/strategies/local/index.js

// [V1.0.0-fix] 從 ES Module 改為 CommonJS
const { spawn } = require('child_process');
const path = require('path');

class LocalStrategy {
    constructor(options) {
        this.pythonPath = options.pythonPath || 'python3';
        this.strategyPath = path.join(process.cwd(), 'src', 'plugins', 'news_scraper', 'strategies', 'local');
        console.log("本地新聞抓取策略 (LocalStrategy) V1.0.0 已初始化。");
    }

    _runPythonScript(scriptName, args) {
        return new Promise((resolve, reject) => {
            const scriptPath = path.join(this.strategyPath, scriptName);
            const pyProcess = spawn(this.pythonPath, [scriptPath, ...args]);
            let stdout = '';
            let stderr = '';
            pyProcess.stdout.on('data', (data) => { stdout += data.toString(); });
            pyProcess.stderr.on('data', (data) => { stderr += data.toString(); });
            pyProcess.on('error', (err) => {
                console.error(`[LocalStrategy] 無法啟動子進程 ${scriptName}:`, err);
                reject(err);
            });
            pyProcess.on('close', (code) => {
                if (code !== 0) {
                    const errorMessage = stderr || `Python script ${scriptName} exited with code ${code}`;
                    console.error(`[LocalStrategy] Python 腳本 ${scriptName} 執行錯誤 (code ${code}): ${errorMessage}`);
                    reject(new Error(errorMessage));
                } else {
                    if (stdout.trim() === '') {
                        resolve('{}');
                        return;
                    }
                    resolve(stdout);
                }
            });
        });
    }

    async send(payload) {
        const { input } = payload;
        const { topic, query, depth = 3 } = input;
        if (!topic || !query) {
            return { success: false, error: "缺少 'topic' 或 'query' 參數。" };
        }

        try {
            console.log(`[LocalStrategy] 步驟 1: 調用 researcher 發現關於 '${topic}' 的來源...`);
            const researcherResult = await this._runPythonScript('researcher.py', [topic, depth.toString()]);
            const researcherData = JSON.parse(researcherResult);
            if (!researcherData.success || !researcherData.result) { return researcherData; }
            
            const discoveredUrls = researcherData.result.discovered_urls;
            if (discoveredUrls.length === 0) {
                return { success: true, result: { relevant_sections: [] }, resultType: "list" };
            }

            console.log(`[LocalStrategy] 步驟 2: 並發抓取 ${discoveredUrls.length} 個已發現的來源...`);
            const scrapePromises = discoveredUrls.map(url => this._runPythonScript('scraper.py', [url]));
            const scrapeResults = await Promise.all(scrapePromises);

            let allArticlesText = '';
            let scrapeErrors = [];
            scrapeResults.forEach((content, index) => {
                try {
                    const data = JSON.parse(content);
                    if (data.success && data.result) {
                        allArticlesText += data.result.article_text + '\n\n';
                    } else {
                        const errorMsg = `抓取 URL ${discoveredUrls[index]} 失敗: ${data.error || '未知錯誤'}`;
                        console.warn(`[LocalStrategy] ${errorMsg}`);
                        scrapeErrors.push(errorMsg);
                    }
                } catch (e) {
                    const errorMsg = `解析 URL ${discoveredUrls[index]} 的 scraper 結果時出錯: ${e.message}`;
                    console.error(`[LocalStrategy] ${errorMsg}`);
                    scrapeErrors.push(errorMsg)
                }
            });
            if (!allArticlesText.trim()) {
                 console.error("[LocalStrategy] 所有來源均抓取失敗。");
                 return { success: false, error: "所有已發現的來源均無法抓取內容。", value: scrapeErrors };
            }

            console.log(`[LocalStrategy] 步驟 3: 調用 librarian 過濾內容...`);
            const filteredResult = await this._runPythonScript('librarian.py', [allArticlesText, query]);
            const filteredData = JSON.parse(filteredResult);
            if (filteredData.success && filteredData.result) {
                 return { success: true, result: filteredData.result, resultType: 'json' };
            }
            return filteredData;
        } catch (error) {
            return { success: false, error: `LocalStrategy 執行失敗: ${error.message}` };
        }
    }
}

// [V1.0.0-fix] 從 ES Module 改為 CommonJS
module.exports = LocalStrategy;