const talker = require('../../../../core/TalkToDemon.js');
const Logger = require('../../../../utils/logger.js');
const PM = require('../../../../core/pluginsManager.js');

let buffer = '';
let isOnline = false;
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
 * 將文字傳送至 ttsEngine 插件
 * @param {string} sentence
 */
async function sendToTtsEngine(sentence) {
  try {
    // 透過 pluginsManager 確認 ttsEngine 狀態，避免離線時送出請求
    const ttsState = await PM.getPluginState('ttsEngine');
    if (ttsState !== 1) {
      logger.warn(`[SpeechBroker] ttsEngine 插件未上線，跳過語音輸出 (狀態: ${ttsState}): ${sentence}`);
      return false;
    }
    PM.send('ttsEngine', sentence);
    logger.info(`[SpeechBroker] 成功送出語音: ${sentence}`);
    return true;
  } catch (e) {
    logger.error(`[SpeechBroker] ttsEngine 輸出失敗: ${e.message || e}`);
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

    handlers.onData = async (chunk) => {
      try {
        if (SENTENCE_ENDINGS.test(chunk)) {
          const sentence = (buffer + chunk).trim();
          const sanitized = sanitizeChunk(sentence);
          
          if (sanitized.length > 0) {
            logger.info(`[SpeechBroker] 偵測到句尾，處理完整句子: "${sentence}" → "${sanitized}"`);
            await sendToTtsEngine(sanitized);
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
          logger.info(`[SpeechBroker] 串流結束，補播殘句: "${buffer.trim()}" → "${remainingSentence}"`);
          await sendToTtsEngine(remainingSentence);
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
          logger.info(`[SpeechBroker] 串流中止，補播殘句: "${buffer.trim()}" → "${remainingSentence}"`);
          await sendToTtsEngine(remainingSentence);
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
