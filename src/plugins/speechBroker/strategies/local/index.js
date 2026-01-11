const talker = require('../../../../core/TalkToDemon.js');
const Logger = require('../../../../utils/logger.js');
const PM = require('../../../../core/pluginsManager.js');

let buffer = '';
let isOnline = false;
let activeMode = 'artifact';
// 儲存事件處理函式，便於 offline 時移除
const handlers = {};

// 建立 logger 實例，輸出至 speechBroker.log
const logger = new Logger('speechBroker.log');

// 此策略的預設啟動優先度
const priority = 75;

// 中文標點轉換對照表（全形 → 半形）以及emoji處理
const PUNCTUATION_MAP = {
  '。': '。',        // 中文句號保持不變
  '？': '?',         // 全形問號 → 半形問號  
  '！': '!',         // 全形驚嘆號 → 半形驚嘆號
  '～': '~',         // 全形波浪號 → 半形波浪號
  '\uFF1F': '?',     // Unicode全形問號
  '\uFF01': '!',     // Unicode全形驚嘆號
  '\u3002': '。',    // Unicode中文句號
  '.': '.',          // 半形句號保持不變
  '♥': '',           // 愛心emoji，移除
  '❤': '',           // 紅心emoji，移除
  '💖': '',          // 閃亮愛心emoji，移除
  '😊': '',          // 微笑emoji，移除
  '😍': '',          // 愛心眼emoji，移除
};

// 匹配中英文句尾符號（不包含emoji，emoji只在清理時移除）
const SENTENCE_ENDINGS = /[。！？?!~～\uFF01\uFF1F\u3002]/;

const MAX_EXPRESSION_LENGTH = 10; // 表情最大長度，避免過長的表情干擾

// 定義 speechBroker 支援的 TTS 模式
const TTS_MODES = {
  ARTIFACT: 'artifact',
  ENGINE: 'engine'
};

// 定義 engine 模式監控超時，避免串流無限等待
const ENGINE_STREAM_TIMEOUT_MS = 120000;
const ENGINE_METADATA_TIMEOUT_MS = 8000;

// 移除表情標記，例如 (害羞)、(微笑)，但保留數字、數學或其他實用內容
// 表情通常是純中文字符，不包含數字、符號或英文
const EXPRESSION_PATTERN = new RegExp(`[\(（]([\u4e00-\u9fff]{1,${MAX_EXPRESSION_LENGTH}})[\)）]`, 'g');

/**
 * 清理字串片段，去除表情並統一標點
 * @param {string} chunk 原始片段
 * @returns {string} 清理後結果
 */
function sanitizeChunk(chunk) {
  // 去除 (表情) - 只移除純中文的括號內容
  let result = chunk.replace(EXPRESSION_PATTERN, '');
  
  // 移除 emoji 字符
  result = result.replace(/[♥❤💖😊😍]/g, '');
  
  // 替換標點（句號不變）
  return result.replace(SENTENCE_ENDINGS, (match) => PUNCTUATION_MAP[match] ?? match);
}

/**
 * 解析使用模式並提供預設值，保持對外接口相容
 * @param {Object} options
 * @returns {string} mode
 */
function resolveMode(options = {}) {
  // 允許傳入 mode，但不影響既有呼叫端結構
  const requestedMode = options.mode || TTS_MODES.ARTIFACT;
  if (requestedMode !== TTS_MODES.ARTIFACT && requestedMode !== TTS_MODES.ENGINE) {
    logger.warn(`[SpeechBroker] 收到未知 mode: ${requestedMode}，已改用預設 ${TTS_MODES.ARTIFACT}`);
    return TTS_MODES.ARTIFACT;
  }
  return requestedMode;
}

/**
 * 建立追蹤資訊，提供日誌與錯誤追蹤
 * @returns {{ traceId: string, requestedAt: string }}
 */
function buildTraceInfo() {
  // 使用時間戳與亂數生成可追蹤 ID
  const traceId = `speechBroker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { traceId, requestedAt: new Date().toISOString() };
}

/**
 * 整理回傳物件摘要，避免完整輸出敏感內容
 * @param {any} payload
 * @returns {string}
 */
function summarizePayload(payload) {
  // 僅輸出欄位與型別，避免洩露內容
  if (payload === null || payload === undefined) {
    return String(payload);
  }
  if (typeof payload !== 'object') {
    return `${typeof payload}: ${String(payload).slice(0, 80)}`;
  }
  const keys = Object.keys(payload);
  const types = keys.reduce((acc, key) => {
    acc[key] = typeof payload[key];
    return acc;
  }, {});
  return `keys=${keys.join(', ')} types=${JSON.stringify(types)}`;
}

/**
 * 驗證 ttsArtifact 的回傳格式，避免上層拿不到預期欄位
 * @param {Object} result
 * @returns {boolean}
 */
function isValidArtifactResult(result) {
  // 必填欄位檢查（artifact_id、url、format、duration_ms）
  if (!result || typeof result !== 'object') {
    return false;
  }
  const { artifact_id, url, format, duration_ms } = result;
  return (
    typeof artifact_id === 'string' &&
    artifact_id.trim().length > 0 &&
    typeof url === 'string' &&
    url.trim().length > 0 &&
    typeof format === 'string' &&
    format.trim().length > 0 &&
    typeof duration_ms === 'number' &&
    !Number.isNaN(duration_ms) &&
    duration_ms >= 0
  );
}

/**
 * 將文字傳送至 ttsArtifact 插件，並驗證回傳格式
 * @param {string} sentence
 * @param {{ traceId: string, requestedAt: string }} traceInfo
 * @returns {Promise<Object|false>} 成功時回傳包含 artifact_id、url、format、duration_ms 的物件，失敗時回傳 false
 */
async function sendToTtsArtifact(sentence, traceInfo) {
  // 檢查 ttsArtifact 插件狀態，避免未註冊或未上線時送出請求
  const ttsArtifactState = await PM.getPluginState('ttsArtifact');
  if (ttsArtifactState === -2) {
    logger.error(
      `[SpeechBroker] ttsArtifact 插件未註冊或找不到 (trace_id=${traceInfo.traceId})`
    );
    return false;
  }
  if (ttsArtifactState !== 1) {
    logger.warn(
      `[SpeechBroker] ttsArtifact 插件未上線，跳過語音輸出 (狀態: ${ttsArtifactState}, trace_id=${traceInfo.traceId})`
    );
    return false;
  }

  // 呼叫 ttsArtifact 建立 artifact，預設不做任何 fallback
  let result;
  try {
    result = await PM.send('ttsArtifact', {
      text: sentence,
      trace_id: traceInfo.traceId,
      requested_at: traceInfo.requestedAt
    });
  } catch (e) {
    logger.error(
      `[SpeechBroker] 呼叫 ttsArtifact 失敗 (trace_id=${traceInfo.traceId}): ${e.message || e}`
    );
    return false;
  }

  // 檢查回傳格式是否符合預期
  if (result && typeof result === 'object' && result.error) {
    // 明確記錄 ttsArtifact 回傳的錯誤訊息
    logger.error(
      `[SpeechBroker] ttsArtifact 回傳錯誤 (trace_id=${traceInfo.traceId}): ${result.error}`
    );
    return false;
  }
  if (!isValidArtifactResult(result)) {
    const expectedFields = ['artifact_id', 'url', 'format', 'duration_ms'];
    const summary = summarizePayload(result);
    logger.error(
      `[SpeechBroker] ttsArtifact 回傳格式錯誤 (trace_id=${traceInfo.traceId}) ` +
      `期望欄位=${expectedFields.join(', ')}，實際內容摘要=${summary}`
    );
    return false;
  }

  // 記錄必要 metadata，提供追蹤與除錯用
  logger.info(
    `[SpeechBroker] ttsArtifact 完成 (trace_id=${traceInfo.traceId}, requested_at=${traceInfo.requestedAt}) ` +
    `artifact_id=${result.artifact_id}, format=${result.format}, duration_ms=${result.duration_ms}`
  );
  return result;
}

/**
 * 將文字傳送至 ttsEngine 插件（低階串流模式）
 * @param {string} sentence
 * @param {{ traceId: string, requestedAt: string }} traceInfo
 * @returns {Promise<Object|false>} 成功時回傳包含 stream 與 metadata 的物件，失敗時回傳 false
 */
async function sendToTtsEngine(sentence, traceInfo) {
  try {
    // 透過 pluginsManager 確認 ttsEngine 狀態，避免離線時送出請求
    const ttsState = await PM.getPluginState('ttsEngine');
    if (ttsState === -2) {
      logger.error(
        `[SpeechBroker] ttsEngine 插件未註冊或找不到 (trace_id=${traceInfo.traceId})`
      );
      return false;
    }
    if (ttsState !== 1) {
      logger.warn(
        `[SpeechBroker] ttsEngine 插件未上線，跳過語音輸出 ` +
        `(狀態: ${ttsState}, trace_id=${traceInfo.traceId})`
      );
      return false;
    }
    const session = await PM.send('ttsEngine', { text: sentence, trace_id: traceInfo.traceId });
    if (!session?.stream || !session?.metadataPromise) {
      logger.error(
        `[SpeechBroker] ttsEngine 回傳格式異常 (trace_id=${traceInfo.traceId})`
      );
      return false;
    }

    // 監聽 metadata，確保包含必要欄位
    let metadata = null;
    try {
      metadata = await Promise.race([
        session.metadataPromise,
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error('ttsEngine metadata 等待逾時')),
            ENGINE_METADATA_TIMEOUT_MS
          );
        })
      ]);
      if (
        !metadata ||
        typeof metadata.format !== 'string' ||
        metadata.format.trim().length === 0 ||
        typeof metadata.sample_rate !== 'number' ||
        metadata.sample_rate <= 0 ||
        typeof metadata.channels !== 'number' ||
        metadata.channels <= 0
      ) {
        logger.error(
          `[SpeechBroker] ttsEngine metadata 格式錯誤 (trace_id=${traceInfo.traceId}) ` +
          `內容摘要=${summarizePayload(metadata)}`
        );
        return false;
      }
      logger.info(
        `[SpeechBroker] ttsEngine metadata 已取得 (trace_id=${traceInfo.traceId}) ` +
        `format=${metadata.format}, sample_rate=${metadata.sample_rate}, channels=${metadata.channels}`
      );
    } catch (err) {
      logger.error(
        `[SpeechBroker] ttsEngine metadata 取得失敗 (trace_id=${traceInfo.traceId}): ${err.message || err}`
      );
      return false;
    }

    // 監控串流結束，若超時仍未結束則記錄錯誤並嘗試中止串流以釋放資源
    const doneTimer = setTimeout(() => {
      logger.error(
        `[SpeechBroker] ttsEngine 串流未收到 done (trace_id=${traceInfo.traceId})`
      );
      try {
        if (session.stream) {
          if (typeof session.stream.destroy === 'function') {
            session.stream.destroy(
              new Error('ttsEngine stream timeout: did not receive end within expected time')
            );
          } else if (typeof session.stream.end === 'function') {
            // 後備方案：若沒有 destroy 方法，呼叫 end 嘗試結束串流
            session.stream.end();
          }
        }
      } catch (destroyErr) {
        logger.error(
          `[SpeechBroker] ttsEngine 串流逾時計劃性中止失敗 (trace_id=${traceInfo.traceId}): ` +
          `${destroyErr.message || destroyErr}`
        );
      }
    }, ENGINE_STREAM_TIMEOUT_MS);
    session.stream.once('end', () => {
      clearTimeout(doneTimer);
      logger.info(`[SpeechBroker] ttsEngine 串流結束 (trace_id=${traceInfo.traceId})`);
    });
    session.stream.once('error', (err) => {
      clearTimeout(doneTimer);
      logger.error(
        `[SpeechBroker] ttsEngine 串流中斷 (trace_id=${traceInfo.traceId}): ${err.message || err}`
      );
    });
    return { stream: session.stream, metadata };
  } catch (e) {
    logger.error(`[SpeechBroker] ttsEngine 輸出失敗 (trace_id=${traceInfo?.traceId || 'unknown'}): ${e.message || e}`);
    return false;
  }
}

module.exports = {
  priority,
  name: 'speechBroker',

  /** 啟動插件，監聽 TalkToDemon 串流輸出 */
  async online(options = {}) {
    if (isOnline) {
      logger.info('[SpeechBroker] 插件已經在線上，跳過重複啟動');
      return;
    }
    isOnline = true;
    buffer = '';
    // 解析並儲存模式設定，確保後續串流處理一致
    activeMode = resolveMode(options);
    logger.info(`[SpeechBroker] 已設定 TTS 模式為 ${activeMode}`);

    handlers.onData = async (chunk) => {
      try {
        if (SENTENCE_ENDINGS.test(chunk)) {
          const sentence = (buffer + chunk).trim();
          const sanitized = sanitizeChunk(sentence);
          
          if (sanitized.length > 0) {
            // 產生追蹤資訊，便於統一記錄與錯誤追蹤
            const traceInfo = buildTraceInfo();
            logger.info(
              `[SpeechBroker] 偵測到句尾，準備送出語音 (mode=${activeMode}, trace_id=${traceInfo.traceId}) ` +
              `"${sentence}" → "${sanitized}"`
            );
            // 根據模式選擇 ttsArtifact 或 ttsEngine，避免隱式 fallback
            if (activeMode === TTS_MODES.ENGINE) {
              const engineResult = await sendToTtsEngine(sanitized, traceInfo);
              // 若 TTS 引擎回傳可讀串流，至少將其設為 flowing 狀態以實際消費音訊資料
              if (engineResult && engineResult.stream && typeof engineResult.stream.resume === 'function') {
                engineResult.stream.resume();
              }
            } else {
              await sendToTtsArtifact(sanitized, traceInfo);
            }
          }
          buffer = '';
        } else {
          buffer += chunk;
        }
      } catch (e) {
        logger.error(`[SpeechBroker] 處理資料時發生錯誤: ${e.message || e}`);
      }
    };
    talker.on('data', handlers.onData);

    handlers.onEnd = async () => {
      try {
        if (buffer.trim().length > 0) {
          const remainingSentence = sanitizeChunk(buffer.trim() + '.');
          // 產生追蹤資訊，補播殘句並維持模式一致
          const traceInfo = buildTraceInfo();
          logger.info(
            `[SpeechBroker] 串流結束，補播殘句 (mode=${activeMode}, trace_id=${traceInfo.traceId}): ` +
            `"${buffer.trim()}" → "${remainingSentence}"`
          );
          if (activeMode === TTS_MODES.ENGINE) {
            const engineResult = await sendToTtsEngine(remainingSentence, traceInfo);
            // 若 TTS 引擎回傳可讀串流，至少將其設為 flowing 狀態以實際消費音訊資料
            if (engineResult && engineResult.stream && typeof engineResult.stream.resume === 'function') {
              engineResult.stream.resume();
            }
          } else {
            await sendToTtsArtifact(remainingSentence, traceInfo);
          }
          buffer = '';
        }
      } catch (e) {
        logger.error(`[SpeechBroker] end事件處理錯誤: ${e.message || e}`);
      }
    };
    talker.on('end', handlers.onEnd);

    handlers.onAbort = async () => {
      try {
        if (buffer.trim().length > 0) {
          const remainingSentence = sanitizeChunk(buffer.trim() + '.');
          // 產生追蹤資訊，補播殘句並維持模式一致
          const traceInfo = buildTraceInfo();
          logger.info(
            `[SpeechBroker] 串流中止，補播殘句 (mode=${activeMode}, trace_id=${traceInfo.traceId}): ` +
            `"${buffer.trim()}" → "${remainingSentence}"`
          );
          if (activeMode === TTS_MODES.ENGINE) {
            const engineResult = await sendToTtsEngine(remainingSentence, traceInfo);
            // 若 TTS 引擎回傳可讀串流，至少將其設為 flowing 狀態以實際消費音訊資料
            if (engineResult && engineResult.stream && typeof engineResult.stream.resume === 'function') {
              engineResult.stream.resume();
            }
          } else {
            await sendToTtsArtifact(remainingSentence, traceInfo);
          }
          buffer = '';
        }
      } catch (e) {
        logger.error(`[SpeechBroker] abort事件處理錯誤: ${e.message || e}`);
      }
    };
    talker.on('abort', handlers.onAbort);

    handlers.onError = (err) => {
      logger.error(`[SpeechBroker] LLM 串流錯誤: ${err.message || err}`);
    };
    talker.on('error', handlers.onError);

    logger.info('[SpeechBroker] 插件已成功上線，開始監聽語音串流');
  },

  /** 關閉插件 */
  async offline() {
    if (!isOnline) {
      logger.info('[SpeechBroker] 插件已經離線，跳過重複關閉');
      return 0;
    }
    
    isOnline = false;
    buffer = '';
    // 重設模式為預設值，避免下次啟動沿用舊設定
    activeMode = TTS_MODES.ARTIFACT;
    
    try {
      // 移除所有事件監聽，避免離線後仍接收資料
      if (handlers.onData) talker.off('data', handlers.onData);
      if (handlers.onEnd) talker.off('end', handlers.onEnd);
      if (handlers.onAbort) talker.off('abort', handlers.onAbort);
      if (handlers.onError) talker.off('error', handlers.onError);
      
      // 清理處理函式引用
      Object.keys(handlers).forEach(k => delete handlers[k]);
      
      logger.info('[SpeechBroker] 插件已成功下線，所有事件監聽已移除');
    } catch (e) {
      logger.error(`[SpeechBroker] 下線過程中發生錯誤: ${e.message || e}`);
    }
    
    return 0;
  },

  /** 重啟插件 */
  async restart(options) {
    await this.offline();
    await new Promise(r => setTimeout(r, 300));
    await this.online(options);
  },

  /** 回傳插件狀態 */
  async state() {
    return isOnline ? 1 : 0;
  }
};
