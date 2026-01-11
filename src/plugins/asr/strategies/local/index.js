const fs = require("fs");
const path = require("path");
const { PythonShell } = require("python-shell");

// 內部引入
// 段落說明：載入專案日誌工具，統一 ASR 記錄格式
const logger = require("../../../../utils/logger.js");
const Logger = new logger("asr.log");

// 段落說明：定義策略優先度，供插件選擇器排序使用
const priority = 80;

// 段落說明：支援的 MIME 類型清單，避免不支援格式導致轉寫失敗
const SUPPORTED_MIME_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "audio/ogg",
  "audio/webm"
]);

// 段落說明：預設逾時設定，避免轉寫過久阻塞上層流程
const DEFAULT_TIMEOUT_MS = 120000;

// 段落說明：回傳錯誤格式的共用工具，統一錯誤結構
function buildError(code, message) {
  return {
    error: {
      code,
      message
    }
  };
}

// 段落說明：語言代碼正規化，避免上層傳入語系與模型參數不一致
function normalizeLanguage(inputLang) {
  if (!inputLang) return "zh";
  const lowerLang = inputLang.toLowerCase();
  if (lowerLang.startsWith("zh")) return "zh";
  if (lowerLang.startsWith("en")) return "en";
  if (lowerLang.startsWith("ja")) return "ja";
  if (lowerLang.startsWith("ko")) return "ko";
  return inputLang;
}

// 段落說明：解析 Python 路徑設定，支援環境變數與呼叫端覆寫
function resolvePythonPath(options = {}) {
  return options.pythonPath || process.env.ASR_PYTHON_PATH || "python";
}

// 段落說明：執行 Python 檔案轉寫腳本並收集輸出
function runPythonTranscription({
  filePath,
  lang,
  model,
  timeoutMs,
  logPath,
  pythonPath,
  useCpu
}) {
  return new Promise((resolve, reject) => {
    // 段落說明：建立 PythonShell 執行個體並準備接收輸出
    const scriptPath = path.resolve(__dirname, "index.py");
    const messages = [];
    const stderrLines = [];

    const args = [
      "--file-path",
      filePath,
      "--lang",
      lang,
      "--model",
      model,
      "--log-path",
      logPath
    ];

    // 段落說明：依照選項加入 CPU 模式旗標
    if (useCpu) {
      args.push("--use-cpu");
    }

    const pyshell = new PythonShell(scriptPath, {
      pythonPath,
      args,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });

    // 段落說明：設定轉寫逾時，避免單次任務佔用過久資源
    let killTimeout = null;
    let timeoutHandler = setTimeout(() => {
      if (pyshell.childProcess) {
        // 段落說明：先嘗試正常終止，給予進程清理機會
        pyshell.childProcess.kill("SIGTERM");
        // 段落說明：若 3 秒後仍未結束，強制終止
        killTimeout = setTimeout(() => {
          if (pyshell.childProcess && !pyshell.childProcess.killed) {
            pyshell.childProcess.kill("SIGKILL");
          }
        }, 3000);
      }
      const error = new Error("ASR_TIMEOUT");
      error.code = "ASR_TIMEOUT";
      reject(error);
    }, timeoutMs);

    pyshell.on("message", (message) => {
      messages.push(message);
    });

    // 段落說明：收集標準錯誤輸出，提供錯誤診斷依據
    pyshell.on("stderr", (stderr) => {
      stderrLines.push(stderr);
    });

    // 段落說明：任務結束後回傳結果或錯誤
    pyshell.end((err) => {
      clearTimeout(timeoutHandler);
      if (killTimeout) {
        clearTimeout(killTimeout);
      }
      if (err) {
        let error = err;

        // 段落說明：若 err 非 Error 物件，轉換為 Error 以統一處理
        if (!(error instanceof Error)) {
          error = new Error(String(err));
        }

        // 段落說明：若原本沒有錯誤代碼，才套用預設 ASR_FAILED
        if (!error.code) {
          error.code = "ASR_FAILED";
        }

        // 段落說明：確保至少有一個錯誤訊息
        if (!error.message) {
          error.message = "ASR_FAILED";
        }

        // 段落說明：補上 stderr 訊息以利除錯，除非原本已有 detail
        if (!error.detail) {
          error.detail = stderrLines.join("\n");
        }

        return reject(error);
      }
      return resolve({ messages, stderrLines });
    });
  });
}

module.exports = {
  priority,
  name: "ASR",
  async online() {
    // 段落說明：檔案模式不需要長時間啟動流程，此處僅提供狀態同步
    Logger.info("[ASR] local 策略已就緒（檔案轉寫模式）");
    return { status: "ready" };
  },

  async offline() {
    // 段落說明：檔案模式無長期進程，故僅回報離線狀態
    Logger.info("[ASR] local 策略已關閉（檔案轉寫模式）");
    return { status: "offline" };
  },

  async restart() {
    // 段落說明：檔案模式以重新回報狀態為主，避免多餘副作用
    await this.offline();
    await this.online();
  },

  async state() {
    // 段落說明：固定回傳可用狀態，供上層監控
    return 1;
  },

  async transcribeFile(input = {}, options = {}) {
    // 段落說明：此方法僅負責檔案轉寫，不包含任何對 talker 的行為
    const startTime = Date.now();

    // 段落說明：基本輸入格式檢查，避免錯誤資料導致例外
    if (!input || typeof input !== "object") {
      return buildError("ASR_FAILED", "輸入格式不正確");
    }

    const originalFilePath = input.file_path;
    const mime = input.mime;
    const lang = normalizeLanguage(input.lang);
    const traceId = input.trace_id || "-";

    // 段落說明：檔案路徑檢查，提供明確錯誤訊息
    if (!originalFilePath) {
      return buildError("ASR_FILE_NOT_FOUND", "未提供檔案路徑");
    }

    // 段落說明：路徑安全性檢查，避免目錄穿越攻擊
    const baseDir = path.resolve(process.env.ASR_INPUT_BASE_DIR || process.cwd());
    const filePath = path.resolve(originalFilePath);
    const relativePath = path.relative(baseDir, filePath);

    // 段落說明：若解析後路徑不在允許的目錄底下，則視為無效路徑
    // 段落說明：relativePath 為 "." 表示檔案路徑等於基礎目錄本身，應拒絕
    if (relativePath.startsWith("..") || relativePath === ".") {
      return buildError("ASR_FILE_NOT_FOUND", "指定的檔案路徑不被允許");
    }

    if (!fs.existsSync(filePath)) {
      return buildError("ASR_FILE_NOT_FOUND", "指定的檔案路徑不存在");
    }

    // 段落說明：格式驗證，避免不支援的音訊格式進入轉寫流程
    if (!mime || !SUPPORTED_MIME_TYPES.has(mime)) {
      return buildError("ASR_INVALID_FORMAT", "不支援的音訊格式");
    }

    // 段落說明：整合轉寫執行所需設定，支援外部覆寫與環境變數
    const timeoutMs = Number(options.timeoutMs || process.env.ASR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    const model = options.model || process.env.ASR_MODEL || "large-v3";
    const logPath = options.logPath || process.env.ASR_LOG_PATH || `${Logger.getLogPath()}/asr.log`;
    const pythonPath = resolvePythonPath(options);
    const useCpu = options.useCpu || false;

    Logger.info(`[ASR] 開始檔案轉寫，trace_id=${traceId}`);

    try {
      // 段落說明：呼叫 Python 腳本取得轉寫結果
      const { messages } = await runPythonTranscription({
        filePath,
        lang,
        model,
        timeoutMs,
        logPath,
        pythonPath,
        useCpu
      });

      // 段落說明：確認 Python 有回傳任何訊息
      if (!Array.isArray(messages) || messages.length === 0) {
        Logger.error(`[ASR] 無法取得轉寫結果（無輸出訊息），trace_id=${traceId}`);
        return buildError("ASR_FAILED", "無法取得轉寫結果");
      }

      let payload = null;

      // 段落說明：逐一處理 Python 輸出，支援多個 JSON 物件（例如進度與最終結果）
      for (let i = 0; i < messages.length; i++) {
        const rawMessage = messages[i];
        if (typeof rawMessage !== "string") {
          continue;
        }

        try {
          const parsed = JSON.parse(rawMessage);

          // 段落說明：若為進度或狀態更新，僅記錄日誌，不作為最終回傳
          if (parsed && (parsed.progress != null || parsed.status != null)) {
            Logger.debug(
              `[ASR] Python 進度更新，trace_id=${traceId}: ${rawMessage}`
            );
          }

          // 段落說明：若包含錯誤或轉寫結果相關欄位，視為候選最終結果
          if (
            parsed &&
            (parsed.error ||
              parsed.result != null ||
              parsed.text != null ||
              parsed.transcript != null)
          ) {
            payload = parsed;
          }
        } catch (parseError) {
          // 段落說明：若最後一則訊息無法解析且尚無任何有效 payload，視為錯誤
          if (i === messages.length - 1 && !payload) {
            Logger.error(
              `[ASR] 轉寫結果解析失敗，trace_id=${traceId}: ${parseError.message}`
            );
            return buildError("ASR_FAILED", "轉寫結果解析失敗");
          }
          // 段落說明：其他無法解析的中間訊息視為一般輸出，忽略即可
        }
      }

      // 段落說明：最終仍無可用結果時回傳錯誤
      if (!payload) {
        Logger.error(`[ASR] 無法取得轉寫結果，trace_id=${traceId}`);
        return buildError("ASR_FAILED", "無法取得轉寫結果");
      }

      // 段落說明：若 Python 回報錯誤，直接回傳錯誤結果
      if (payload && payload.error) {
        Logger.warn(`[ASR] 轉寫返回錯誤，trace_id=${traceId}: ${payload.error.message}`);
        return payload;
      }

      // 段落說明：清理空值欄位，符合上層可選欄位規格
      if (payload && payload.confidence === null) {
        delete payload.confidence;
      }
      if (payload && payload.segments == null) {
        delete payload.segments;
      }

      // 段落說明：完成時回傳轉寫結果資料
      const duration = Date.now() - startTime;
      Logger.info(`[ASR] 檔案轉寫完成，trace_id=${traceId}，耗時 ${duration}ms`);
      return payload;
    } catch (error) {
      const duration = Date.now() - startTime;
      // 段落說明：逾時錯誤處理與回報
      if (error.code === "ASR_TIMEOUT") {
        Logger.error(`[ASR] 檔案轉寫逾時，trace_id=${traceId}，耗時 ${duration}ms`);
        return buildError("ASR_TIMEOUT", "轉寫逾時");
      }
      // 段落說明：一般錯誤處理與回報
      Logger.error(`[ASR] 檔案轉寫失敗，trace_id=${traceId}，耗時 ${duration}ms: ${error.message}`);
      return buildError("ASR_FAILED", "轉寫執行失敗");
    }
  }
};
