const path = require("path");
const { PythonShell } = require("python-shell");
// 引入共用 logger，統一記錄 ttsEngine 的狀態與錯誤
const logger = require("../../../../utils/logger.js");

// 保存 PythonShell 參照，確保流程可控
let processRef = null;
// 設定 log 檔名為 ttsEngine.log，避免舊名稱殘留
const Logger = new logger("ttsEngine.log");
// 保存等待中的請求，讓呼叫端能收到音訊輸出
const pendingRequests = new Map();
// 產生唯一 requestId，對應 Python 端回傳結果
let requestCounter = 0;
// 避免無限等待，提供基本超時保護
const REQUEST_TIMEOUT_MS = 30000;

// 此策略的啟動優先度
const priority = 70;

// 建立 requestId，確保多筆請求可正確對應
// Note: JavaScript is single-threaded, so requestCounter increment is atomic
function buildRequestId() {
  requestCounter += 1;
  return `ttsEngine-${Date.now()}-${requestCounter}`;
}

// 統一清理尚未完成的請求，避免關閉時留下懸掛
function rejectPendingRequests(reason) {
  for (const { reject, timeoutId } of pendingRequests.values()) {
    clearTimeout(timeoutId);
    reject(reason);
  }
  pendingRequests.clear();
}

module.exports = {
  priority,
  name: "ttsEngine",

  // 啟動 ttsEngine 腳本
  async online(options = {}) {
    if (processRef) {
      Logger.info("[ttsEngine] 已啟動，略過重複啟動");
      return;
    }

    // Python 腳本位於兩層上層
    const scriptPath = path.resolve(__dirname, "index.py");
    try {
      const pythonPath = options.pythonPath || process.env.TTSENGINE_PYTHON_PATH;
      processRef = new PythonShell(scriptPath, {
        ...(pythonPath ? { pythonPath } : {}),
        args: [
          "--log-path", options.logPath || `${Logger.getLogPath()}/ttsEngine.log`
        ],
        env: { ...process.env, PYTHONIOENCODING: "utf-8" }
      });
    } catch (err) {
      // 這裡保留錯誤資訊，協助定位 Python 啟動失敗原因
      Logger.error(`[ttsEngine] 啟動 PythonShell 失敗: ${err.message || err}`);
      throw err;
    }

    Logger.info("[ttsEngine] PythonShell 啟動完成");

    processRef.on("message", (msg) => {
      // 這裡負責解析 Python 端的 JSON 輸出，統一音訊輸出格式
      try {
        const payload = JSON.parse(msg);
        const { id, error } = payload || {};
        if (id && pendingRequests.has(id)) {
          const { resolve, reject, timeoutId } = pendingRequests.get(id);
          clearTimeout(timeoutId);
          pendingRequests.delete(id);
          if (error) {
            // 若 Python 回傳錯誤，立即回報給呼叫端並記錄 log
            Logger.error(`[ttsEngine] 音訊合成失敗: ${error}`);
            reject(new Error(error));
          } else {
            resolve(payload);
          }
          return;
        }
        Logger.info(`[ttsEngine] 非預期輸出: ${msg}`);
      } catch (err) {
        // JSON 解析失敗時記錄原始輸出，避免吞掉訊息
        Logger.warn(`[ttsEngine] 無法解析 Python 輸出: ${msg}`);
      }
    });

    processRef.on("stderr", (err) => {
      // Python stderr 顯示的錯誤訊息，直接寫入 log 便於排查
      Logger.error(`[ttsEngine] Python stderr: ${err}`);
    });

    processRef.on("close", (code) => {
      // Python 進程結束時清理等待中的請求
      Logger.info(`[ttsEngine] PythonShell 結束, code=${code}`);
      rejectPendingRequests(new Error("ttsEngine Python 進程已結束"));
      processRef = null;
    });
  },

  // 關閉 ttsEngine 腳本
  async offline() {
    if (processRef) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          Logger.warn("[ttsEngine] 進程關閉超時，強制終止");
          try {
            if (processRef && !processRef.terminated) {
              processRef.kill('SIGTERM');
            }
          } catch (e) {
            Logger.error("[ttsEngine] 強制終止失敗: " + e);
          }
          rejectPendingRequests(new Error("ttsEngine 關閉超時"));
          processRef = null;
          resolve();
        }, 2000); // 2 second timeout for tests

        processRef.end((err, code, signal) => {
          clearTimeout(timeout);
          Logger.info(`[ttsEngine] 結束, code=${code}, signal=${signal}`);
          if (err) {
            Logger.error("[ttsEngine] 關閉時出錯: " + err);
          }
          rejectPendingRequests(new Error("ttsEngine 已關閉"));
          processRef = null;
          resolve();
        });
      });
      return 0; // 符合規範
    }

    Logger.info("[ttsEngine] 尚未啟動");
    return 0;
  },

  // 重啟
  async restart(options = {}) {
    await this.offline();
    await new Promise(r => setTimeout(r, 500));
    await this.online(options);
  },

  // 狀態查詢
  async state() {
    try {
      if (processRef && !processRef.terminated) {
        return 1; // 上線
      }
      if (processRef && processRef.terminated) {
        return 0; // 已下線
      }
      return 0; // 完全沒啟動
    } catch (e) {
      Logger.error("[ttsEngine] state 查詢錯誤: " + e);
      return -1; // 錯誤
    }
  },

  // 選用函數（外部發送訊息到 ttsEngine 腳本）
  async send(data) {
    if (!processRef || processRef.terminated || !processRef.stdin) {
      Logger.warn("[ttsEngine] send 失敗，進程未啟動或已終止");
      return false;
    }

    // 只允許傳入文字或包含 text 欄位的物件，確保責任邊界清楚
    const text = typeof data === "string" ? data : data?.text;
    if (!text) {
      Logger.error("[ttsEngine] send 輸入格式錯誤，缺少 text");
      return false;
    }

    const requestId = buildRequestId();

    // 方案 A：透過 JSON line 回傳完整音訊資料與 metadata（format、sample_rate）
    // 呼叫端可直接取得 base64 PCM 並自行決定播放或儲存方式
    const payload = { id: requestId, text };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        Logger.error(`[ttsEngine] 請求逾時: ${requestId}`);
        reject(new Error("ttsEngine 請求逾時"));
      }, REQUEST_TIMEOUT_MS);

      pendingRequests.set(requestId, { resolve, reject, timeoutId });

      try {
        processRef.send(JSON.stringify(payload));
        Logger.info(`[ttsEngine] 已發送資料: ${requestId}`);
      } catch (err) {
        clearTimeout(timeoutId);
        pendingRequests.delete(requestId);
        Logger.error(`[ttsEngine] send 發送失敗: ${err.message || err}`);
        reject(err);
      }
    });
  }
};
