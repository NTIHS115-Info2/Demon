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

// 預設啟動優先度
const priority = 50;

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
   * @returns {Promise<Object>} 啟動結果
   */
  async online(options = {}) {
    try {
      state.config = buildConfig(options);
      const response = await runPython({ action: 'ping' }, state.config);
      state.online = true;
      state.lastError = null;
      state.lastResult = response;
      state.metrics.lastRunAt = new Date().toISOString();
      state.metrics.totalRuns += 1;
      logger.info('iotVisionTurret 本地策略已上線');
      return { ok: true, data: response };
    } catch (e) {
      state.online = false;
      state.lastError = e.message;
      logger.error('iotVisionTurret 本地策略啟動失敗: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'LOCAL_ONLINE_ERROR', details: e } };
    }
  },

  /**
   * 關閉本地策略
   * @returns {Promise<Object>} 關閉結果
   */
  async offline() {
    try {
      state.online = false;
      state.lastError = null;
      logger.info('iotVisionTurret 本地策略已離線');
      return { ok: true };
    } catch (e) {
      state.lastError = e.message;
      logger.error('iotVisionTurret 本地策略離線失敗: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'LOCAL_OFFLINE_ERROR', details: e } };
    }
  },

  /**
   * 重啟本地策略
   * @param {Object} options - 重啟設定
   * @returns {Promise<Object>} 重啟結果
   */
  async restart(options = {}) {
    try {
      await this.offline();
      return await this.online(options);
    } catch (e) {
      state.lastError = e.message;
      logger.error('iotVisionTurret 本地策略重啟失敗: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'LOCAL_RESTART_ERROR', details: e } };
    }
  },

  /**
   * 回傳目前服務狀態
   * @returns {Promise<Object>} 狀態資訊
   */
  async state() {
    try {
      return {
        ok: true,
        state: {
          online: state.online,
          lastError: state.lastError,
          lastResult: state.lastResult,
          config: { ...state.config },
          metrics: { ...state.metrics }
        }
      };
    } catch (e) {
      logger.error('iotVisionTurret 本地策略狀態查詢失敗: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'LOCAL_STATE_ERROR', details: e } };
    }
  },

  /**
   * 傳送資料給 Python runner 並取得結果
   * @param {Object} data - 影像辨識或控制指令參數
   * @returns {Promise<Object>} 處理結果
   */
  async send(data = {}) {
    try {
      if (!state.online) {
        return { ok: false, error: { message: 'iotVisionTurret 尚未上線', code: 'LOCAL_OFFLINE' } };
      }
      const response = await runPython({ action: 'infer', payload: data }, state.config);
      state.lastResult = response;
      state.lastError = null;
      state.metrics.lastRunAt = new Date().toISOString();
      state.metrics.totalRuns += 1;
      return { ok: true, data: response };
    } catch (e) {
      state.lastError = e.message;
      logger.error('iotVisionTurret 本地策略送出失敗: ' + e.message);
      return { ok: false, error: { message: e.message, code: 'LOCAL_SEND_ERROR', details: e } };
    }
  }
};
