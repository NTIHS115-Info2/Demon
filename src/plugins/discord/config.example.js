// Discord 設定檔範例
// 請複製此檔案為 config.js 並填入正確的值
// 所有標示為 "請填入" 的值都必須設定

module.exports = {
  "token": "YOUR_BOT_TOKEN_HERE",
  "applicationId": "YOUR_APPLICATION_ID_HERE",
  "guildId": "YOUR_GUILD_ID_HERE",
  "channelId": "YOUR_CHANNEL_ID_HERE",
  "userId": "YOUR_USER_ID_HERE",
  "intents": [
    "Guilds",
    "GuildMessages",
    "MessageContent"
  ],
  "reconnect": {
    "maxRetries": 5,
    "retryDelay": 5000
  }
};
