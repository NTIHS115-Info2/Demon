const path = require("path");
const { PythonShell } = require("python-shell");

// 內部引入
// 調整路徑以符合最新的專案架構
const talker = require("../../../../core/TalkToDemon.js");
const logger = require("../../../../utils/logger.js");

let processRef = null;
const Logger = new logger("asr.log");

function endPythonShell(shell) {
  return new Promise((resolve, reject) => {
    shell.end((err, code, signal) => {
      processRef = null;
      Logger.info(`[ASR 結束] code=${code}, signal=${signal}`);
      if (err) {
        Logger.error("[ASR 錯誤]", err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

module.exports = {
  name: "ASR",
  async online(options = {}) {
    // Python 執行檔相對於此策略目錄上兩層
    const scriptPath = path.resolve(__dirname, "..", "..", "index.py");
    const pyshell = new PythonShell(scriptPath, {
      pythonPath: "E:\system\whisperenv\Scripts\python.exe",
      args: [
        "--device-id", options.deviceId || "1",
        "--use-cpu",
        "--blacklist", (options.blacklist || []).join(","),
        "--model", options.model || "large-v3",
        "--log-path", options.logPath || `${Logger.getLogPath()}/asr.log`,
        "--slice-duration", options.sliceDuration || "4"
      ],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });

    processRef = pyshell;

    pyshell.on("message", (msg) => {
      try {

        if(msg === "asr_start") {

          Logger.info("[ASR] 開始轉錄");

          if(talker.getState() === "idle") return;

          talker.closeGate();
          return;
        }

        if(msg === "asr_ignore") {

          talker.openGate();
          return;
        }

        const json = JSON.parse(msg);
        if (json.partial) {
          Logger.info("[ASR Partial] " + json.partial);
          return;
        }
        if (json.text) {
          if (talker.getGateState() === "close") talker.manualAbort();
          // 這邊會直接把ASR的文字傳到ollama那邊
          talker.talk("爸爸", json.text , {
            uninterruptible: false,
            important: false
          });
        }
      } catch (e){
        Logger.info("[ASR Log] : " + msg);
        Logger.error("[ASR 錯誤] : " + e);
      }
    });
  },

  async offline() {
    if (processRef) {
      await endPythonShell(processRef);
      Logger.info("[ASR] 已關閉");
      return Promise.resolve();
    } else {
      Logger.info("[ASR] 尚未啟動");
    }
  },

  async restart(options) {
    await this.offline();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.online(options);
  },

  async state(){
    return (processRef) ? 1 : 0;
  }
};
