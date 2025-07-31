const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const Logger = require('../../../../utils/logger');
const logger = new Logger('DISCORD');

// 必須存在的設定檔，讀取失敗時拋出錯誤
let config;
try {
  config = require('../../configLoader');
} catch (e) {
  logger.error('[DISCORD] 無法讀取設定檔: ' + e.message);
  throw e;
}

let commands = [];

/**
 * 設定 slash 指令，可選擇指定 guild 或全域註冊
 * @param {object} options { applicationId, guildId, token }
 */
async function register(options = {}) {
  const { applicationId, guildId, token } = { ...config, ...options };
  
  // 驗證必要參數
  if (!applicationId || !token) {
    logger.warn('[DISCORD] 缺少 applicationId 或 token，跳過指令註冊');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const data = commands.map(cmd => cmd.toJSON());

  try {

    if (guildId == 'global') {
      await rest.put(Routes.applicationCommands(applicationId), { body: data });
      logger.info(`[DISCORD] 全域 Slash 指令註冊完成 (${data.length} 個指令)`);
    } else {
      await rest.put(
        Routes.applicationGuildCommands(applicationId, guildId),
        { body: data }
      );
      logger.info(`[DISCORD] Guild Slash 指令註冊完成 (${data.length} 個指令)`);
    }
    
  } catch (e) {
    // 避免記錄可能包含敏感資訊的完整錯誤
    const safeError = e.code ? `Discord API 錯誤 (${e.code})` : '註冊指令時發生未知錯誤';
    logger.error('[DISCORD] 註冊指令失敗: ' + safeError);
  }
}

function setupDefaultCommands() {
  commands = [
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('檢查機器人狀態')
  ];
}

function handle(client) {
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    try {
      if (interaction.commandName === 'ping') {
        await interaction.reply({
          content: 'Pong! 🏓',
          ephemeral: true // 只有執行者看得到回覆
        });
        logger.info('[DISCORD] ping 指令執行成功');
      } else {
        logger.warn(`[DISCORD] 未知的指令: ${interaction.commandName}`);
        await interaction.reply({
          content: '抱歉，我不認識這個指令。',
          ephemeral: true
        });
      }
    } catch (e) {
      // 安全的錯誤處理，避免洩露敏感資訊
      const safeError = e.code ? `處理指令時發生錯誤 (${e.code})` : '處理指令時發生未知錯誤';
      logger.error('[DISCORD] Slash 指令處理錯誤: ' + safeError);
      
      // 嘗試回覆錯誤訊息給使用者
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '執行指令時發生錯誤，請稍後再試。',
            ephemeral: true
          });
        }
      } catch (replyError) {
        logger.error('[DISCORD] 回覆錯誤訊息失敗');
      }
    }
  });
}

module.exports = { register, setupDefaultCommands, handle };
