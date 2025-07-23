const Logger = require('../../../../utils/logger');
const talker = require('../../../../core/TalkToDemon');
const config = require('../../config');

const logger = new Logger('DISCORD');

// 允許互動的使用者 ID，預設取自 config
const OWNER_ID = config.userId || 'cookice';

// 回覆非作者訊息時的預設內容
const DENY_MESSAGE = '我還學不會跟別人說話';

/**
 * 按標點偵測逐句回覆
 * @param {object} msg Discord 訊息物件
 * @param {string} text 原始回覆內容
 */
async function replyBySentence(msg, text) {
  let buffer = '';
  // 只要遇到句號類標點就立即傳送該段文字
  const regex = /[。.!?]/;

  // 傳送封裝，確保錯誤不會使流程中斷
  const send = async sentence => {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    try {
      await msg.reply(trimmed);
    } catch (e) {
      logger.error('[DISCORD] 回覆失敗: ' + e);
    }
  };

  return new Promise((resolve, reject) => {
    const onData = chunk => {
      buffer += chunk;
      let idx;
      // 持續檢查當前緩衝區是否包含標點
      while ((idx = buffer.search(regex)) !== -1) {
        const part = buffer.slice(0, idx + 1);
        buffer = buffer.slice(idx + 1);
        send(part);
      }
    };
    const onEnd = () => {
      send(buffer);
      cleanup();
      resolve();
    };
    const onError = err => {
      cleanup();
      logger.error('[DISCORD] TalkToDemon 錯誤: ' + err);
      reject(err);
    };

    function cleanup(){
      talker.off('data', onData);
      talker.off('end', onEnd);
      talker.off('error', onError);
    }

    talker.on('data', onData);
    talker.on('end', onEnd);
    talker.on('error', onError);

    try { talker.talk('爸爸', text); } catch(e){ onError(e); }
  });
}

/**
 * 私訊處理
 * @param {object} msg Discord 訊息物件
 * @param {string} [uid] 允許互動的使用者 ID
 */
async function handleDirectMessage(msg, uid = OWNER_ID) {
  if (msg.author.id !== uid) return msg.reply(DENY_MESSAGE);
  return replyBySentence(msg, msg.content);
}

/**
 * 提及訊息處理
 * @param {object} msg Discord 訊息物件
 * @param {string} botId Bot 自身的 ID
 * @param {string} [uid] 允許互動的使用者 ID
 */
async function handleMentionMessage(msg, botId, uid = OWNER_ID) {
  if (msg.author.id !== uid) return msg.reply(DENY_MESSAGE);
  const clean = msg.content.replace(new RegExp(`<@!?${botId}>`,'g'), '').trim();
  return replyBySentence(msg, clean);
}

/**
 * 回覆訊息處理
 * @param {object} msg Discord 訊息物件
 * @param {string} [uid] 允許互動的使用者 ID
 */
async function handleReplyMessage(msg, uid = OWNER_ID) {
  if (msg.author.id !== uid) return msg.reply(DENY_MESSAGE);
  return replyBySentence(msg, msg.content);
}

/**
 * 附加訊息監聽器，讀取特定頻道並回覆 Mention
 * @param {import('discord.js').Client} client
 * @param {object} options { channelId }
 */
function attach(client, options = {}) {
  const targetChannel = options.channelId || config.channelId;
  const allowId = options.userId || OWNER_ID;

  client.on('messageCreate', async msg => {
    try {
      if (targetChannel && msg.channel.id !== targetChannel) return;
      if (msg.author.bot) return;

      if (msg.channel.type === 1 || msg.channel.type === 'DM') {
        await handleDirectMessage(msg, allowId);
      } else if (msg.reference && msg.mentions.repliedUser && msg.mentions.repliedUser.id === client.user.id) {
        await handleReplyMessage(msg, allowId);
      } else if (msg.mentions.has(client.user)) {
        await handleMentionMessage(msg, client.user.id, allowId);
      }
    } catch (e) {
      logger.error('[DISCORD] 處理訊息錯誤: ' + e);
    }
  });
}

module.exports = { attach, handleDirectMessage, handleMentionMessage, handleReplyMessage };
