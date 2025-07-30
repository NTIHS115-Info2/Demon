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

// 中文標點轉換對照表（全形 → 半形）
const PUNCTUATION_MAP = {
  '。': '。',
  '？': '?',
  '！': '!',
  '～': '~',
  '.': '.',
  '♥': '', // 視為 emoji，移除
};

// 匹配中英文句尾符號（包含 emoji）
const SENTENCE_ENDINGS = /[。！？?!.~～♥\uFF01\uFF1F\u3002]/;

// 移除表情標記，例如 (害羞)、(微笑)
const EXPRESSION_PATTERN = /[\(（][^\)）]{1,10}[\)）]/g;

/**
 * 清理字串片段，去除表情並統一標點
 * @param {string} chunk 原始片段
 * @returns {string} 清理後結果
 */
function sanitizeChunk(chunk) {
  // 去除 (表情)
  const noExpression = chunk.replace(EXPRESSION_PATTERN, '');
  // 替換標點（句號不變）
  return noExpression.replace(SENTENCE_ENDINGS, (match) => PUNCTUATION_MAP[match] ?? match);
}

/**
 * 將文字傳送至 TTS 插件
 * @param {string} sentence
 */
async function sendToTTS(sentence) {
  try {
    if (await PM.getPluginState('tts') !== 1) {
      logger.warn('[SpeechBroker] TTS 插件未上線，無法送出，狀態碼: ' + await PM.getPluginState('tts'));
      logger.warn('[SpeechBroker] TTS 插件未上線，無法送出: ' + sentence);
      return;
    }
    PM.send('tts', sentence);
    logger.info('[SpeechBroker] 送出 TTS: ' + sentence);
  } catch (e) {
    logger.error('[SpeechBroker] TTS 輸出失敗: ' + e);
  }
}

module.exports = {
  priority,
  name: 'speechBroker',

  /** 啟動插件，監聽 TalkToDemon 串流輸出 */
  async online(options = {}) {
    if (isOnline) return;
    isOnline = true;
    buffer = '';

    handlers.onData = async (chunk) => {
      if (SENTENCE_ENDINGS.test(chunk)) {
        const sentence = (buffer + chunk).trim();
        const sanitized = sanitizeChunk(sentence);
        if (sentence.length > 0) {
          await sendToTTS(sanitized);
        }
        buffer = '';
      } else {
        buffer += chunk;
      }
    };
    talker.on('data', handlers.onData);

    handlers.onEnd = async () => {
      if (buffer.trim().length > 0) {
        await sendToTTS(buffer.trim() + '.');
        logger.info('[SpeechBroker] 串流完成，餘句送出: ' + buffer.trim());
        buffer = '';
      }
    };
    talker.on('end', handlers.onEnd);

    handlers.onAbort = async () => {
      if (buffer.trim().length > 0) {
        await sendToTTS(buffer.trim() + '.');
        logger.info('[SpeechBroker] 中止輸出，餘句送出: ' + buffer.trim());
        buffer = '';
      }
    };
    talker.on('abort', handlers.onAbort);

    handlers.onError = (err) => {
      logger.error('[SpeechBroker] LLM 串流錯誤: ' + err);
    };
    talker.on('error', handlers.onError);

    logger.info('[SpeechBroker] 插件已上線');
  },

  /** 關閉插件 */
  async offline() {
    if (!isOnline) return 0;
    isOnline = false;
    buffer = '';
    // 移除所有事件監聽，避免離線後仍接收資料
    talker.off('data', handlers.onData);
    talker.off('end', handlers.onEnd);
    talker.off('abort', handlers.onAbort);
    talker.off('error', handlers.onError);
    Object.keys(handlers).forEach(k => delete handlers[k]);
    logger.info('[SpeechBroker] 插件已下線');
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
