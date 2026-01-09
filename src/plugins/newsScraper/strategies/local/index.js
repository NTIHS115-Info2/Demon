// src/plugins/newsScraper/strategies/local/index.js
// 職責：包含所有業務邏輯和狀態管理。
const path = require('path');
const { spawn } = require('child_process');
const Logger = require('../../../../utils/logger');
const logger = new Logger('newsScraper_local_strategy.log');

// 【狀態封裝】將狀態變量設為內部變量
let isOnline = false;
let pythonPath = 'python3'; // 預設值

function sanitizePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

function normalizeDetailLevel(detailLevel) {
    if (typeof detailLevel !== 'string') {
        return 'normal';
    }
    const normalized = detailLevel.trim().toLowerCase();
    if (['concise', 'normal', 'deep_dive'].includes(normalized)) {
        return normalized;
    }
    return 'normal';
}

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

function resolveDetailMapping(detailLevel) {
    const mapping = {
        concise: { articleCount: 2, topK: 2 },
        normal: { articleCount: 3, topK: 3 },
        deep_dive: { articleCount: 5, topK: 5 }
    };
    return mapping[detailLevel] || mapping.normal;
}

/**
 * 執行 Python 腳本的核心邏輯 (私有函數)
 * @param {string} scriptName - 'scraper.py' 或 'librarian.py' 等
 * @param {object} payload - 傳遞給腳本的 JSON payload
 * @returns {Promise<object>} - 返回解析後的 JSON 物件
 */
function _runPythonScript(scriptName, payload) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, scriptName);
        const serializedPayload = JSON.stringify(payload ?? {});
        const pyProcess = spawn(pythonPath, [scriptPath, serializedPayload]);
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
                // [V1.0.0-alpha] 修正：處理 Python 腳本可能無 stdout 的情況
                if (!stdout.trim()) {
                    logger.warn(`Python script ${scriptName} did not produce any stdout.`);
                    return resolve({}); // 返回空物件而非拋出錯誤
                }
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
        await new Promise((resolve) => setTimeout(resolve, 100));
        await this.online(options);
    },

    async state() {
        return isOnline ? 1 : 0;
    },

    async send(payload = {}) {
        if (!isOnline) {
            return { success: false, error: 'Local strategy is offline.' };
        }

        const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
        const rawQuery = typeof payload.query === 'string' ? payload.query.trim() : '';
        const normalizedDetailLevel = normalizeDetailLevel(payload.detail_level);
        const keywordList = normalizeKeywords(payload.keywords);
        const mapping = resolveDetailMapping(normalizedDetailLevel);
        const articleCount = sanitizePositiveInteger(
            payload.article_count !== undefined ? payload.article_count : mapping.articleCount,
            mapping.articleCount
        );
        const topK = sanitizePositiveInteger(
            payload.top_k !== undefined ? payload.top_k : mapping.topK,
            mapping.topK
        );
        const device = typeof payload.device === 'string' && payload.device.trim() ? payload.device.trim() : 'cpu';
        const keywordQuery = keywordList.join(' ');
        const effectiveQuery = keywordQuery || rawQuery;

        if (!rawUrl || !effectiveQuery) {
            return { success: false, error: "Missing 'url' or 'query' in payload." };
        }

        try {
            const scrapedData = await _runPythonScript('scraper.py', {
                url: rawUrl,
                article_count: articleCount,
                detail_level: normalizedDetailLevel,
                keywords: keywordList
            });
            if (!scrapedData.success) return scrapedData;

            const articleText = scrapedData?.result?.article_text ?? '';
            if (!articleText.trim()) {
                logger.warn(`Scraper for ${rawUrl} returned empty content.`);
                return { success: true, result: { relevant_sections: [] }, resultType: 'object' };
            }

            return await _runPythonScript('librarian.py', {
                text_content: articleText,
                query: effectiveQuery,
                top_k: topK,
                device,
                detail_level: normalizedDetailLevel,
                keywords: keywordList
            });
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};
