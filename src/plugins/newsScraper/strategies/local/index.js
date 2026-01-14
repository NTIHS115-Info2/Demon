// src/plugins/newsScraper/strategies/local/index.js
// 職責：包含所有業務邏輯和狀態管理，作為 researcher.py 的 Node.js 橋接層。
const path = require('path');
const { spawn } = require('child_process');
const Logger = require('../../../../utils/logger');
const logger = new Logger('newsScraper_local_strategy.log');

// 【狀態封裝】將狀態變量設為內部變量
let isOnline = false;
let pythonPath = 'python'; // 預設值

/**
 * 正規化 detail_level 參數
 * 支援 researcher.py 的 DetailLevel: "concise" | "quick" | "normal" | "deep_dive"
 * @param {*} detailLevel - 輸入的 detail_level
 * @returns {string} - 正規化後的 detail_level
 */
function normalizeDetailLevel(detailLevel) {
    if (typeof detailLevel !== 'string') {
        return 'normal';
    }
    const normalized = detailLevel.trim().toLowerCase();
    if (['concise', 'quick', 'normal', 'deep_dive'].includes(normalized)) {
        return normalized;
    }
    return 'normal';
}

/**
 * 正規化 keywords 參數為字串陣列
 * @param {*} rawKeywords - 輸入的 keywords (可為陣列或字串)
 * @returns {string[]} - 正規化後的 keywords 陣列
 */
function normalizeKeywords(rawKeywords) {
    if (Array.isArray(rawKeywords)) {
        return rawKeywords
            .filter((keyword) => typeof keyword === 'string')
            .map((keyword) => keyword.trim())
            .filter((keyword) => keyword.length > 0);
    }
    if (typeof rawKeywords === 'string') {
        const trimmed = rawKeywords.trim();
        return trimmed ? [trimmed] : [];
    }
    return [];
}

/**
 * 執行 Python 腳本的核心邏輯 (私有函數)
 * @param {string} scriptName - 'researcher.py'
 * @param {object} payload - 傳遞給腳本的 JSON payload
 * @returns {Promise<object>} - 返回解析後的 JSON 物件 (ResearcherOutput)
 */
function _runPythonScript(scriptName, payload) {
  return new Promise((resolve, reject) => {
    const serializedPayload = JSON.stringify(payload ?? {});

    // 1) 找專案根：從 strategies/local 往上回到 Demon 根目錄（有 src/ 那層）
    // __dirname = .../src/plugins/newsScraper/strategies/local
    const projectRoot = path.resolve(__dirname, '../../../../..'); // 回到專案根（Demon）
    // 你也可以加保險：確保 projectRoot 下有 src
    // const srcDir = path.join(projectRoot, 'src');

    // 2) 用 -m 方式跑模組，而不是直接跑 .py
    const moduleName = 'src.plugins.newsScraper.strategies.local.researcher';
    const args = ['-m', moduleName, serializedPayload];

    const pyProcess = spawn(pythonPath || 'python', args, {
      cwd: projectRoot,
      windowsHide: true,
      env: {
        ...process.env,
        // 保底：讓 python 找得到專案根下的 src（即便 cwd 被改也能跑）
        PYTHONPATH: projectRoot + (process.env.PYTHONPATH ? `;${process.env.PYTHONPATH}` : ''),
      },
    });

    let stdout = '';
    let stderr = '';
    pyProcess.stdout.setEncoding('utf8');
    pyProcess.stderr.setEncoding('utf8');
    pyProcess.stdout.on('data', (data) => { stdout += data; });
    pyProcess.stderr.on('data', (data) => { stderr += data; });

    pyProcess.on('error', (err) =>
      reject(new Error(`Python process spawn error: ${err.message}`))
    );

    pyProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `Python exited with code ${code}`));
      }
      try {
        if (!stdout.trim()) {
          logger.warn(`Python module ${moduleName} did not produce any stdout.`);
          return resolve({ success: false, error: 'No output from Python module.', resultType: 'object' });
        }
        resolve(JSON.parse(stdout));
      } catch (e) {
        logger.error(`Raw stdout from ${moduleName}: ${stdout}`);
        reject(new Error(`Failed to parse JSON from ${moduleName}.`));
      }
    });
  });
}


module.exports = {
    /**
     * 啟動本地策略
     * @param {object} options - 選項
     * @param {string} [options.pythonPath] - Python 執行路徑
     */
    async online(options = {}) {
        if (options.pythonPath) {
            pythonPath = options.pythonPath;
        }
        isOnline = true;
        logger.info(`Local strategy is now online with python: ${pythonPath}.`);
    },

    /**
     * 關閉本地策略
     */
    async offline() {
        isOnline = false;
        logger.info('Local strategy is now offline.');
    },

    /**
     * 重啟本地策略
     * @param {object} options - 選項
     */
    async restart(options = {}) {
        await this.offline();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await this.online(options);
    },

    /**
     * 取得當前狀態
     * @returns {Promise<number>} - 1 表示上線，0 表示離線
     */
    async state() {
        return isOnline ? 1 : 0;
    },

    /**
     * 執行新聞搜尋研究
     * 
     * 輸入 (ResearcherInput):
     * @param {object} payload - 搜尋參數
     * @param {string} payload.topic - 搜尋主題 (必填，最大 200 字元)
     * @param {string} [payload.query] - 搜尋查詢字串 (選填，最大 200 字元)
     * @param {string[]} [payload.keywords] - 關鍵字列表 (選填)
     * @param {string} [payload.detail_level] - 詳細程度 (選填): "concise" | "quick" | "normal" | "deep_dive"
     * 
     * 輸出 (ResearcherOutput):
     * @returns {Promise<object>} - 搜尋結果
     * @returns {boolean} return.success - 是否成功
     * @returns {object} [return.result] - 搜尋結果 (ResearcherResult)
     * @returns {Array<{url: string, title: string, snippet: string}>} return.result.items - 搜尋項目列表
     * @returns {string} [return.error] - 錯誤訊息
     * @returns {string} return.resultType - 結果類型 ("object")
     */
    async send(payload = {}) {
        if (!isOnline) {
            return { success: false, error: 'Local strategy is offline.', resultType: 'object' };
        }

        // 解析並驗證輸入參數
        const rawTopic = typeof payload.topic === 'string' ? payload.topic.trim() : '';
        const rawQuery = typeof payload.query === 'string' ? payload.query.trim() : '';
        const normalizedDetailLevel = normalizeDetailLevel(payload.detail_level);
        const keywordList = normalizeKeywords(payload.keywords);

        // topic 為必填欄位
        if (!rawTopic) {
            return { success: false, error: "Missing 'topic' in payload.", resultType: 'object' };
        }

        // 驗證 topic 長度限制
        if (rawTopic.length > 200) {
            return { success: false, error: "Topic exceeds maximum length of 200 characters.", resultType: 'object' };
        }

        // 驗證 query 長度限制
        if (rawQuery.length > 200) {
            return { success: false, error: "Query exceeds maximum length of 200 characters.", resultType: 'object' };
        }

        try {
            // 建構 ResearcherInput payload
            const researcherPayload = {
                topic: rawTopic,
                query: rawQuery,
                keywords: keywordList,
                detail_level: normalizedDetailLevel
            };

            logger.info(`Calling researcher.py with payload: ${JSON.stringify(researcherPayload)}`);
            const result = await _runPythonScript('researcher.py', researcherPayload);
            
            // result 應為 ResearcherOutput 格式：
            // { success: boolean, result?: ResearcherResult, error?: string, resultType: string }
            logger.info(`researcher.py returned: success=${result.success}`);
            return result;
        } catch (error) {
            logger.error(`researcher.py execution failed: ${error.message}`);
            return { success: false, error: error.message, resultType: 'object' };
        }
    }
};
