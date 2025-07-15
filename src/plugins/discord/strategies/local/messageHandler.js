const Logger = require('../../../../utils/logger');
const logger = new Logger('DISCORD');

/**
 * 附加訊息監聽器，讀取特定頻道並回覆 Mention
 * @param {import('discord.js').Client} client
 * @param {object} options { channelId }
 */
function attach(client, options = {}) {
  const targetChannel = options.channelId;
  client.on('messageCreate', async msg => {
    try {
      if (targetChannel && msg.channel.id !== targetChannel) return;
      if (msg.author.bot) return;

      if (msg.mentions.has(client.user)) {
        await msg.reply('您好，有什麼可以幫忙的嗎?');
      }
    } catch (e) {
      logger.error('[DISCORD] 處理訊息錯誤: ' + e);
    }
  });
}

module.exports = { attach };
