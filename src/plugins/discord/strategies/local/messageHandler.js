const Logger = require('../../../../utils/logger');
const talker = require('../../../../core/TalkToDemon');
const logger = new Logger('DISCORD');

// 嘗試讀取設定檔，若失敗直接拋出錯誤
let config;
try {
  config = require('../../config');
} catch (e) {
  logger.error('[DISCORD] 無法讀取設定檔: ' + e.message);
  throw e;
}

// 允許互動的使用者 ID，預設取自 config
const OWNER_ID = config.userId || 'cookice';

/**
 * 按標點偵測逐句回覆
 * @param {object} msg Discord 訊息物件
 * @param {string} text 原始回覆內容
 * @param {string} [speakerName] 說話者名稱，如果未提供則使用預設邏輯
 */
async function replyBySentence(msg, text, speakerName) {
  let buffer = '';
  // 只要遇到句號類標點就立即傳送該段文字
  const regex = /[。!?]/;

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
      // let idx;
      // // 持續檢查當前緩衝區是否包含標點
      // while ((idx = buffer.search(regex)) !== -1) {
      //   const part = buffer.slice(0, idx + 1);
      //   buffer = buffer.slice(idx + 1);
      //   send(part);
      // }
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

    // 使用傳入的說話者名稱，如果沒有提供則使用預設值
    const finalSpeakerName = speakerName || '爸爸';
    try { talker.talk(finalSpeakerName, text); } catch(e){ onError(e); }
  });
}

/**
 * 私訊處理
 * @param {object} msg Discord 訊息物件
 * @param {string} [uid] 允許互動的使用者 ID（擁有者ID）
 */
async function handleDirectMessage(msg, uid = OWNER_ID) {
  // 僅允許特定使用者互動，其餘回覆固定訊息
  if (msg.author.id !== uid) {
    try {
      await msg.reply('我還學不會跟別人說話');
    } catch (e) {
      logger.error('[DISCORD] 回覆失敗: ' + e);
    }
    return;
  }
  // 對於擁有者，使用預設稱呼
  const speakerName = '爸爸';
  return replyBySentence(msg, msg.content, speakerName);
}

/**
 * 提及訊息處理
 * @param {object} msg Discord 訊息物件
 * @param {string} botId Bot 自身的 ID
 * @param {string} [uid] 允許互動的使用者 ID（擁有者ID）
 */
async function handleMentionMessage(msg, botId, uid = OWNER_ID) {
  const clean = msg.content.replace(new RegExp(`<@!?${botId}>`,'g'), '').trim();
  
  // 對於擁有者，使用預設邏輯（'爸爸'）
  // 對於其他人，使用他們的顯示名稱
  const speakerName = msg.author.id === uid ? '爸爸' : (msg.member?.displayName || msg.author.displayName || msg.author.username);
  return replyBySentence(msg, clean, speakerName);
}

/**
 * 回覆訊息處理
 * @param {object} msg Discord 訊息物件
 * @param {string} [uid] 允許互動的使用者 ID（擁有者ID）
 */
async function handleReplyMessage(msg, uid = OWNER_ID) {
  // 對於擁有者，使用預設邏輯（'爸爸'）
  // 對於其他人，使用他們的顯示名稱
  const speakerName = msg.author.id === uid ? '爸爸' : (msg.member?.displayName || msg.author.displayName || msg.author.username);
  return replyBySentence(msg, msg.content, speakerName);
}

/**
 * 附加訊息監聽器，預設全域監聽並回覆 Mention
 * @param {import('discord.js').Client} client
 * @param {object} options { channelId }
 */
function attach(client, options = {}) {
  // 可選擇限制監聽的頻道 ID，預設空值代表全域監聽
  const targetChannel = options.channelId || config.channelId;
  const allowId = options.userId || OWNER_ID;

  client.on('messageCreate', async msg => {
    try {
      // 若指定頻道則只監聽該頻道
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
