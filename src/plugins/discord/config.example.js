// Discord 設定檔範例
// 請複製此檔案為 config.js 並填入正確的值
// 所有標示為 "請填入" 的值都必須設定

module.exports = {
  "token": "請填入您的Discord Bot Token",
  "applicationId": "請填入您的應用程式ID",
  "guildId": "請填入您的伺服器ID",
  "channelId": "請填入您的頻道ID",
  "userId": "請填入您的使用者ID或留空",
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
