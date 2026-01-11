const Logger = require('../../../../utils/logger');
const talker = require('../../../../core/TalkToDemon');
const logger = new Logger('DISCORD');

// 嘗試讀取設定檔，若失敗直接拋出錯誤
let config;
try {
  config = require('../../configLoader');
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
      // 避免記錄可能包含敏感資訊的完整錯誤
      const safeError = e.code ? `Discord API 錯誤 (${e.code})` : '回覆訊息時發生未知錯誤';
      logger.error('[DISCORD] 回覆失敗: ' + safeError);
    }
  };

  return new Promise((resolve, reject) => {
    let waitingTool = false
    const onData = chunk => {
      buffer += chunk;
    };
    // ★ 修正：使用 end 事件傳遞的 toolTriggered 參數來判斷是否繼續等待
    const onEnd = (info = {}) => {
      send(buffer);
      // 優先使用 end 事件傳遞的 toolTriggered，其次使用 status 事件設定的 waitingTool
      const shouldWait = info.toolTriggered ?? waitingTool;
      if (!shouldWait) {
        cleanup();
        resolve();
      }
      buffer = '';  // 清空緩衝區
    };
    const onError = err => {
      cleanup();
      logger.error('[DISCORD] TalkToDemon 錯誤: ' + err);
      reject(err);
    };
    const onStatus = status => {
      waitingTool = status.waiting;
      logger.info('[DISCORD] TalkToDemon 狀態更新: ' + JSON.stringify(status));
    };

    function cleanup(){
      talker.off('data', onData);
      talker.off('end', onEnd);
      talker.off('error', onError);
      talker.off('status', onStatus);
    }

    talker.on('data', onData);
    talker.on('end', onEnd);
    talker.on('error', onError);
    talker.on('status' , onStatus);

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
      logger.info('[DISCORD] 回覆非擁有者的 DM');
    } catch (e) {
      // 避免記錄可能包含敏感資訊的完整錯誤
      const safeError = e.code ? `Discord API 錯誤 (${e.code})` : '回覆 DM 時發生未知錯誤';
      logger.error('[DISCORD] 回覆失敗: ' + safeError);
    }
    return;
  }
  
  // 對於擁有者，使用預設稱呼
  const speakerName = '爸爸';
  logger.info('[DISCORD] 處理擁有者的 DM');
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
  
  if (!clean) {
    logger.info('[DISCORD] 收到空的提及訊息，忽略');
    return;
  }
  
  // 對於擁有者，使用預設邏輯（'爸爸'）
  // 對於其他人，使用他們的顯示名稱
  const speakerName = msg.author.id === uid ? '爸爸' : (msg.member?.displayName || msg.author.displayName || msg.author.username);
  logger.info(`[DISCORD] 處理 ${speakerName} 的提及訊息`);
  return replyBySentence(msg, clean, speakerName);
}

/**
 * 回覆訊息處理
 * @param {object} msg Discord 訊息物件
 * @param {string} [uid] 允許互動的使用者 ID（擁有者ID）
 */
async function handleReplyMessage(msg, uid = OWNER_ID) {
  if (!msg.content.trim()) {
    logger.info('[DISCORD] 收到空的回覆訊息，忽略');
    return;
  }
  
  // 對於擁有者，使用預設邏輯（'爸爸'）
  // 對於其他人，使用他們的顯示名稱
  const speakerName = msg.author.id === uid ? '爸爸' : (msg.member?.displayName || msg.author.displayName || msg.author.username);
  logger.info(`[DISCORD] 處理 ${speakerName} 的回覆訊息`);
  return replyBySentence(msg, msg.content, speakerName);
}

/**
 * 附加訊息監聽器，預設全域監聽並回覆 Mention
 * @param {import('discord.js').Client} client
 * @param {object} options { channelId }
 */
function attach(client, options = {}) {
  let targetChannel = null;
  // 可選擇限制監聽的頻道 ID，global 代表全域監聽
  if (config.channelId !== 'global' || options.channelId !== 'global') {
    targetChannel = options.channelId || config.channelId;
  }
  
  const allowId = options.userId || OWNER_ID;

  logger.info(`[DISCORD] 附加訊息監聽器 - 目標頻道: ${targetChannel || '全域'}, 擁有者: ${allowId}`);

  client.on('messageCreate', async msg => {
    try {
      // 若指定頻道則只監聽該頻道
      if (targetChannel && msg.channel.id !== targetChannel) return;
      
      // 忽略機器人訊息
      if (msg.author.bot) return;
      
      // 忽略空訊息
      if (!msg.content || !msg.content.trim()) return;

      if (msg.channel.type === 1 || msg.channel.type === 'DM') {
        logger.info('[DISCORD] 收到 DM 訊息');
        await handleDirectMessage(msg, allowId);
      } else if (msg.reference && msg.mentions.repliedUser && msg.mentions.repliedUser.id === client.user.id) {
        logger.info('[DISCORD] 收到回覆訊息');
        await handleReplyMessage(msg, allowId);
      } else if (msg.mentions.has(client.user)) {
        logger.info('[DISCORD] 收到提及訊息');
        await handleMentionMessage(msg, client.user.id, allowId);
      }
    } catch (e) {
      // 避免記錄可能包含敏感資訊的完整錯誤
      const safeError = e.code ? `處理訊息時發生 Discord API 錯誤 (${e.code})` : '處理訊息時發生未知錯誤';
      logger.error('[DISCORD] 處理訊息錯誤: ' + safeError);
    }
  });
}

module.exports = { attach, handleDirectMessage, handleMentionMessage, handleReplyMessage };
