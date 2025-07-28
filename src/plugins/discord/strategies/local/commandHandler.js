const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const Logger = require('../../../../utils/logger');
const logger = new Logger('DISCORD');

// 必須存在的設定檔，讀取失敗時拋出錯誤
let config;
try {
  config = require('../../config');
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
  if (!applicationId || !token) return;

  const rest = new REST({ version: '10' }).setToken(token);
  const data = commands.map(cmd => cmd.toJSON());

  try {
    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(applicationId, guildId),
        { body: data }
      );
    } else {
      await rest.put(Routes.applicationCommands(applicationId), { body: data });
    }
    logger.info('[DISCORD] Slash 指令註冊完成');
  } catch (e) {
    logger.error('[DISCORD] 註冊指令失敗: ' + e);
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
        await interaction.reply('Pong!');
      }
    } catch (e) {
      logger.error('[DISCORD] Slash 指令處理錯誤: ' + e);
    }
  });
}

module.exports = { register, setupDefaultCommands, handle };
