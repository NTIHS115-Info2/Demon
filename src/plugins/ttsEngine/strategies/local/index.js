const path = require("path");
const { spawn } = require("child_process");
const { PassThrough } = require("stream");
// 引入共用 logger，統一記錄 ttsEngine 的狀態與錯誤
const logger = require("../../../../utils/logger.js");

// 保存 Python 進程參照，確保流程可控
let processRef = null;
// 設定 log 檔名為 ttsEngine.log，避免舊名稱殘留
const Logger = new logger("ttsEngine.log");
// 單一 session 管理（符合單 session in-flight 策略）
let activeSessionId = null;
// 保存 session 資料，供 stdout frame 解析時使用
const sessions = new Map();

// 此策略的啟動優先度
const priority = 70;

// 產生唯一 sessionId，對應 Python 端回傳結果
let sessionCounter = 0;
function buildSessionId() {
  sessionCounter += 1;
  return `ttsEngine-${Date.now()}-${sessionCounter}`;
}

// 統一清理尚未完成的 session，避免關閉時留下懸掛
function rejectPendingSessions(reason) {
  for (const session of sessions.values()) {
    if (session?.stream && !session.stream.destroyed) {
      session.stream.destroy(reason);
    }
    // Only reject metadata if it hasn't been resolved yet
    if (session?.metadataReject && !session?.metadataResolved) {
      try {
        session.metadataReject(reason);
      } catch (err) {
        // Promise may already be resolved/rejected, ignore error
      }
    }
  }
  sessions.clear();
  activeSessionId = null;
}

// 將 stdin JSONL 事件寫入 Python 端
function writeInputEvent(event) {
  if (!processRef || processRef.killed || !processRef.stdin) {
    throw new Error("ttsEngine 進程未啟動或已終止");
  }
  const line = `${JSON.stringify(event)}\n`;
  processRef.stdin.write(line, "utf8");
}

// 建立新的 session 物件，供外部取得 stream 與控制流程
function buildSession() {
  if (activeSessionId) {
    throw new Error("ttsEngine 正在處理其他 session");
  }
  const sessionId = buildSessionId();
  activeSessionId = sessionId;

  // 建立可讀 stream，持續推送 PCM chunks
  const stream = new PassThrough();

  // 準備 metadata promise，等待 start frame 回傳
  let metadataResolve;
  let metadataReject;
  const metadataPromise = new Promise((resolve, reject) => {
    metadataResolve = resolve;
    metadataReject = reject;
  });

  // 保存 session 供 frame 解析時查找
  const sessionData = {
    sessionId,
    stream,
    seq: 0,
    metadataResolve,
    metadataReject,
    metadataResolved: false,
    textSent: false
  };
  sessions.set(sessionId, sessionData);

  return {
    sessionId,
    stream,
    metadataPromise,
    sendText: (text) => {
      if (!text) {
        throw new Error("sendText 缺少 text");
      }
      writeInputEvent({ type: "text", session_id: sessionId, text });
      // Mark that text has been sent
      sessionData.textSent = true;
    },
    end: () => {
      if (!sessionData.textSent) {
        throw new Error("必須先呼叫 sendText 才能呼叫 end");
      }
      writeInputEvent({ type: "end", session_id: sessionId });
    }
  };
}

// 解析 Python stdout 的 frame protocol（長度前綴 + JSON header + PCM payload）
function attachFrameParser() {
  let buffer = Buffer.alloc(0);

  function handleFrame(frame, payload) {
    const session = sessions.get(frame.session_id);
    if (!session) {
      Logger.warn(`[ttsEngine] 收到未知 session frame: ${frame.session_id}`);
      return;
    }

    if (frame.type === "start") {
      // 收到 start frame，回傳 metadata 並通知呼叫端
      session.metadataResolved = true;
      session.metadataResolve({
        format: frame.format,
        sample_rate: frame.sample_rate,
        channels: frame.channels
      });
      session.stream.emit("metadata", {
        format: frame.format,
        sample_rate: frame.sample_rate,
        channels: frame.channels
      });
      return;
    }

    if (frame.type === "audio") {
      // 音訊 frame 必須依序輸出，保持 seq 遞增
      if (typeof frame.seq !== "number" || frame.seq !== session.seq) {
        const error = new Error("音訊 seq 不連續，資料可能損毀");
        Logger.error(`[ttsEngine] ${error.message}`);
        session.stream.destroy(error);
        sessions.delete(frame.session_id);
        // Only clear activeSessionId if this is the active session
        if (activeSessionId === frame.session_id) {
          activeSessionId = null;
        }
        return;
      }
      session.seq += 1;
      if (payload && payload.length === frame.payload_bytes) {
        session.stream.write(payload);
      } else {
        const error = new Error("audio payload 長度不一致");
        Logger.error(`[ttsEngine] ${error.message}`);
        session.stream.destroy(error);
        sessions.delete(frame.session_id);
        // Only clear activeSessionId if this is the active session
        if (activeSessionId === frame.session_id) {
          activeSessionId = null;
        }
      }
      return;
    }

    if (frame.type === "done") {
      // 收到 done frame，結束 stream
      session.stream.end();
      sessions.delete(frame.session_id);
      // Only clear activeSessionId if this is the active session
      if (activeSessionId === frame.session_id) {
        activeSessionId = null;
      }
      return;
    }

    if (frame.type === "error") {
      // 收到 error frame，回報錯誤並清理 session
      const error = new Error(frame.message || "ttsEngine 發生錯誤");
      error.code = frame.code;
      Logger.error(`[ttsEngine] Python error: ${error.message}`);
      session.stream.destroy(error);
      if (!session.metadataResolved) {
        try {
          session.metadataReject(error);
        } catch (err) {
          // Promise may already be handled, ignore
        }
      }
      sessions.delete(frame.session_id);
      // Only clear activeSessionId if this is the active session
      if (activeSessionId === frame.session_id) {
        activeSessionId = null;
      }
      return;
    }

    Logger.warn(`[ttsEngine] 未知 frame 類型: ${frame.type}`);
  }

  processRef.stdout.on("data", (chunk) => {
    // 收到 stdout chunk，拼接後依序解析 frame
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const frameLen = buffer.readUInt32BE(0);
      // Add maximum frame length validation to prevent resource exhaustion
      const MAX_FRAME_LENGTH = 50 * 1024 * 1024; // 50MB
      if (frameLen > MAX_FRAME_LENGTH) {
        Logger.error(`[ttsEngine] frame 長度過大: ${frameLen} bytes，超過限制 ${MAX_FRAME_LENGTH} bytes`);
        // Skip this corrupted frame and continue
        buffer = buffer.slice(4);
        continue;
      }
      if (buffer.length < 4 + frameLen) {
        return;
      }
      const frameJson = buffer.slice(4, 4 + frameLen).toString("utf8");
      let frame;
      try {
        frame = JSON.parse(frameJson);
      } catch (err) {
        Logger.error(`[ttsEngine] 解析 frame JSON 失敗: ${err.message}`);
        // 單一 frame JSON 壞掉時，只丟棄該 frame，保留其餘 buffer，避免中止所有 sessions
        buffer = buffer.slice(4 + frameLen);
        continue;
      }
      let offset = 4 + frameLen;
      if (frame.type === "audio") {
        const payloadBytes = frame.payload_bytes || 0;
        if (buffer.length < offset + payloadBytes) {
          return;
        }
        const payload = buffer.slice(offset, offset + payloadBytes);
        buffer = buffer.slice(offset + payloadBytes);
        handleFrame(frame, payload);
      } else {
        buffer = buffer.slice(offset);
        handleFrame(frame, null);
      }
    }
  });
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
    const pythonPath = options.pythonPath || process.env.TTSENGINE_PYTHON_PATH || "python";

    try {
      processRef = spawn(pythonPath, [scriptPath, "--log-path", options.logPath || `${Logger.getLogPath()}/ttsEngine.log`], {
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (err) {
      // 這裡保留錯誤資訊，協助定位 Python 啟動失敗原因
      Logger.error(`[ttsEngine] 啟動 Python 進程失敗: ${err.message || err}`);
      throw err;
    }

    // 將 stdout 解析為 frame
    attachFrameParser();

    processRef.stderr.on("data", (data) => {
      // Python stderr 顯示的錯誤訊息，直接寫入 log 便於排查
      Logger.error(`[ttsEngine] Python stderr: ${data.toString()}`);
    });

    processRef.on("close", (code) => {
      // Python 進程結束時清理等待中的 session
      Logger.info(`[ttsEngine] Python 進程結束, code=${code}`);
      rejectPendingSessions(new Error("ttsEngine Python 進程已結束"));
      processRef = null;
    });

    Logger.info("[ttsEngine] Python 進程啟動完成");
  },

  // 關閉 ttsEngine 腳本
  async offline() {
    if (processRef) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          Logger.warn("[ttsEngine] 進程關閉超時，強制終止");
          try {
            if (processRef && !processRef.killed) {
              processRef.kill("SIGTERM");
            }
          } catch (e) {
            Logger.error("[ttsEngine] 強制終止失敗: " + e);
          }
          rejectPendingSessions(new Error("ttsEngine 關閉超時"));
          processRef = null;
          resolve();
        }, 2000); // 2 second timeout for tests

        const closeHandler = (code, signal) => {
          clearTimeout(timeout);
          Logger.info(`[ttsEngine] 結束, code=${code}, signal=${signal}`);
          rejectPendingSessions(new Error("ttsEngine 已關閉"));
          processRef = null;
          resolve();
        };

        // Remove any existing close handlers before adding new one
        processRef.removeAllListeners("close");
        processRef.on("close", closeHandler);

        if (
          processRef.stdin &&
          !processRef.stdin.destroyed &&
          !processRef.stdin.writableEnded
        ) {
          processRef.stdin.end();
        }
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
      if (processRef && !processRef.killed) {
        return 1; // 上線
      }
      if (processRef && processRef.killed) {
        return 0; // 已下線
      }
      return 0; // 完全沒啟動
    } catch (e) {
      Logger.error("[ttsEngine] state 查詢錯誤: " + e);
      return -1; // 錯誤
    }
  },

  // 建立可持續輸入的 session（提供 stream 與控制介面）
  async createSession() {
    if (!processRef || processRef.killed || !processRef.stdin) {
      Logger.warn("[ttsEngine] createSession 失敗，進程未啟動或已終止");
      throw new Error("ttsEngine 進程未啟動");
    }

    // 單 session in-flight 限制：如有正在處理的 session 直接拒絕
    if (activeSessionId) {
      Logger.error("[ttsEngine] 目前已有 session 處理中");
      throw new Error("ttsEngine 目前已有 session 處理中");
    }

    const session = buildSession();
    Logger.info(`[ttsEngine] 已建立 session: ${session.sessionId}`);
    return session;
  },

  // 單次輸入的簡化介面：送出 text + end，回傳可讀 stream
  async send(data) {
    if (!processRef || processRef.killed || !processRef.stdin) {
      Logger.warn("[ttsEngine] send 失敗，進程未啟動或已終止");
      throw new Error("ttsEngine 進程未啟動");
    }

    // 只允許傳入文字或包含 text 欄位的物件，確保責任邊界清楚
    const text = typeof data === "string" ? data : data?.text;
    if (!text) {
      Logger.error("[ttsEngine] send 輸入格式錯誤，缺少 text");
      throw new Error("ttsEngine send 缺少 text");
    }

    const session = buildSession();
    try {
      session.sendText(text);
      session.end();
    } catch (err) {
      Logger.error(`[ttsEngine] send 發送失敗: ${err.message || err}`);
      throw err;
    }

    return session;
  }
};
