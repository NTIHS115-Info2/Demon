const path = require('path');
const { spawn } = require('child_process');
const Logger = require('../../../../utils/logger');

// 檔案用途：提供 iotVisionTurret 本地策略，負責呼叫 Python runner 與管理狀態

// 建立記錄器（對外顯示名稱統一為 iotVisionTurret）
const logger = new Logger('iotVisionTurret');

// 狀態資料結構區塊：保存服務狀態、設定與最近執行結果
const state = {
  online: false,
  lastError: null,
  lastResult: null,
  config: {
    pythonPath: 'python3',
    runnerPath: path.join(__dirname, 'index.py'),
    timeoutMs: 15000
  },
  metrics: {
    lastRunAt: null,
    totalRuns: 0
  }
};

// 併發控制：保存正在執行的 Promise 與佇列
let activeRequest = null;

// 預設啟動優先度
const priority = 50;

/**
 * 處理佇列中的請求，確保一次只有一個請求執行
 * @param {Object} data - 請求資料
 * @returns {Promise<boolean>}
 */
async function executeRequest(data) {
  // 等待前一個請求完成
  while (activeRequest) {
    try {
      await activeRequest;
    } catch (e) {
      // 忽略前一個請求的錯誤
      logger.warn('前一個請求失敗: ' + e.message);
    }
  }
  
  // 建立當前請求的 Promise
  const requestPromise = (async () => {
    try {
      const response = await runPython({ action: 'infer', payload: data }, state.config);
      state.lastResult = response;
      state.lastError = null;
      state.metrics.lastRunAt = new Date().toISOString();
      state.metrics.totalRuns += 1;
      return true;
    } finally {
      // 完成後清空 active request（僅當前請求）
      if (activeRequest === requestPromise) {
        activeRequest = null;
      }
    }
  })();
  
  // 立即設定為活動請求
  activeRequest = requestPromise;
  return await requestPromise;
}

/**
 * 合併與驗證設定
 * @param {Object} options - 來源設定
 * @returns {Object} 合併後設定
 */
function buildConfig(options = {}) {
  return {
    pythonPath: options.pythonPath || state.config.pythonPath,
    runnerPath: options.runnerPath || state.config.runnerPath,
    timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : state.config.timeoutMs
  };
}

/**
 * 呼叫本地 Python runner 並取得回應
 * @param {Object} payload - 傳遞給 Python 的 JSON 內容
 * @param {Object} config - 執行設定
 * @returns {Promise<Object>} Python 回傳結果
 */
function runPython(payload, config) {
  return new Promise((resolve, reject) => {
    const processArgs = [config.runnerPath];
    const child = spawn(config.pythonPath, processArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error('Python runner 執行逾時'));
      }
    }, config.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(`Python runner 非正常結束 (code=${code}): ${stderr}`));
        return;
      }
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : {};
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Python runner 回傳 JSON 解析失敗: ${err.message}`));
      }
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(err);
    }
  });
}

module.exports = {
  priority,
  /**
   * 啟動本地策略
   * @param {Object} options - 啟動設定
   */
  async online(options = {}) {
    state.config = buildConfig(options);
    const response = await runPython({ action: 'ping' }, state.config);
    state.online = true;
    state.lastError = null;
    state.lastResult = response;
    state.metrics.lastRunAt = new Date().toISOString();
    state.metrics.totalRuns += 1;
    logger.info('iotVisionTurret 本地策略已上線');
  },

  /**
   * 關閉本地策略
   */
  async offline() {
    state.online = false;
    state.lastError = null;
    logger.info('iotVisionTurret 本地策略已離線');
  },

  /**
   * 重啟本地策略
   * @param {Object} options - 重啟設定
   */
  async restart(options = {}) {
    await this.offline();
    await this.online(options);
  },

  /**
   * 回傳目前服務狀態
   * @returns {Promise<number>} 狀態碼：1=online, 0=offline, -1=error
   */
  async state() {
    return state.online ? 1 : 0;
  },

  /**
   * 傳送資料給 Python runner 並取得結果
   * @param {Object} data - 影像辨識或控制指令參數
   * @returns {Promise<boolean>} 是否成功傳送
   */
  async send(data = {}) {
    if (!state.online) {
      throw new Error('iotVisionTurret 尚未上線');
    }
    
    return await executeRequest(data);
  }
};
