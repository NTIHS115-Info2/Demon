const path = require("path");
const { PythonShell } = require("python-shell");
// 更新路徑至新的 utils 位置
const logger = require("../../../../utils/logger.js");

let processRef = null;
const Logger = new logger("tts.log");

module.exports = {
  name: "TTS",

  // 啟動 TTS 腳本
  async online(options = {}) {
    if (processRef) {
      Logger.info("[TTS] 已啟動，略過重複啟動");
      return;
    }
    // Python 腳本位於兩層上層
    const scriptPath = path.resolve(__dirname, "index.py");
    processRef = new PythonShell(scriptPath, {
      pythonPath: options.pythonPath || "E:\system\f5ttsenv\Scripts\python.exe",
      args: [
        "--log-path", options.logPath || `${Logger.getLogPath()}/tts.log`
      ],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });

    Logger.info("[TTS] PythonShell 啟動完成");

    processRef.on("message", (msg) => {
      Logger.info("[TTS] 輸出: " + msg);
      // 你可以根據需要，對 msg 做自定義事件處理
    });

    processRef.on("stderr", (err) => {
      Logger.error("[TTS] 錯誤: " + err);
    });

    processRef.on("close", (code) => {
      Logger.info(`[TTS] PythonShell 結束, code=${code}`);
      processRef = null;
    });
  },

  // 關閉 TTS 腳本
  async offline() {
    if (processRef) {
      await new Promise((resolve, reject) => {
        processRef.end((err, code, signal) => {
          processRef = null;
          Logger.info(`[TTS] 結束, code=${code}, signal=${signal}`);
          if (err) {
            Logger.error("[TTS] 關閉時出錯: " + err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
      return 0; // 符合規範
    } else {
      Logger.info("[TTS] 尚未啟動");
      return 0;
    }
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
      } else if (processRef && processRef.terminated) {
        return 0; // 已下線
      } else {
        return 0; // 完全沒啟動
      }
    } catch (e) {
      Logger.error("[TTS] state 查詢錯誤: " + e);
      return -1; // 錯誤
    }
  },

  // 選用函數（外部發送訊息到 TTS 腳本）
  async send(data) {
    if (processRef && !processRef.terminated && processRef.stdin) {
      processRef.send(data);
      Logger.info(`[TTS] 已發送資料: ${data}`);
    } else {
      Logger.warn("[TTS] send 失敗，進程未啟動或已終止");
    }
  }
};
