const path = require('path');
const configManager = require('../../utils/configManager');
const Logger = require('../../utils/logger');

const logger = new Logger('configManager.log');

// Discord 設定檔驗證綱要
const DISCORD_CONFIG_SCHEMA = {
  required: ['token', 'applicationId', 'guildId', 'channelId'],
  types: {
    token: 'string',
    applicationId: 'string',
    guildId: 'string',
    channelId: 'string',
    userId: 'string'
  }
};

// 設定檔路徑
const CONFIG_PATH = path.join(__dirname, 'config.js');
const EXAMPLE_PATH = path.join(__dirname, 'config.example.js');

// 範例設定內容
const EXAMPLE_CONFIG = {
  "token": "YOUR_BOT_TOKEN_HERE", // Replace with your Discord Bot Token or use process.env.DISCORD_BOT_TOKEN
  "applicationId": "YOUR_APPLICATION_ID_HERE", // Replace with your Application ID or use process.env.APPLICATION_ID
  "guildId": "YOUR_GUILD_ID_HERE", // Replace with your Guild ID or use process.env.GUILD_ID
  "channelId": "YOUR_CHANNEL_ID_HERE", // Replace with your Channel ID or use process.env.CHANNEL_ID
  "userId": "YOUR_USER_ID_HERE", // Replace with your User ID or leave empty, or use process.env.USER_ID
  "intents": ["Guilds", "GuildMessages", "MessageContent"],
  "reconnect": {
    "maxRetries": 5,
    "retryDelay": 5000
  }
};

/**
 * 載入並驗證 Discord 設定檔
 * @returns {object} 驗證後的設定物件
 */
function loadDiscordConfig() {
  try {
    return configManager.loadAndValidate(CONFIG_PATH, DISCORD_CONFIG_SCHEMA, 'Discord');
  } catch (error) {
    if (error.code === 'CONFIG_NOT_FOUND') {
      // 如果設定檔不存在，創建範例設定檔
      try {
        configManager.createExampleConfig(EXAMPLE_PATH, EXAMPLE_CONFIG, 'Discord');
        logger.error(`\n請設定 Discord 設定檔:`);
        logger.error(`1. 複製 ${EXAMPLE_PATH} 為 ${CONFIG_PATH}`);
        logger.error(`2. 編輯 ${CONFIG_PATH} 並填入正確的值`);
        logger.error(`3. 重新啟動應用程式\n`);
      } catch (createError) {
        logger.error('無法創建範例設定檔:', createError.message);
      }
    }
    throw error;
  }
}

module.exports = loadDiscordConfig();