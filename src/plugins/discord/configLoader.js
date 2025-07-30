const path = require('path');
const configManager = require('../../utils/configManager');

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
  "token": "請填入您的Discord Bot Token",
  "applicationId": "請填入您的應用程式ID", 
  "guildId": "請填入您的伺服器ID",
  "channelId": "請填入您的頻道ID",
  "userId": "請填入您的使用者ID或留空",
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
        console.error(`\n請設定 Discord 設定檔:`);
        console.error(`1. 複製 ${EXAMPLE_PATH} 為 ${CONFIG_PATH}`);
        console.error(`2. 編輯 ${CONFIG_PATH} 並填入正確的值`);
        console.error(`3. 重新啟動應用程式\n`);
      } catch (createError) {
        console.error('無法創建範例設定檔:', createError.message);
      }
    }
    throw error;
  }
}

module.exports = loadDiscordConfig();