// Discord Bot 設定檔範本
// 請將此檔案複製為 config.js 並填入實際的設定值

module.exports = {
  // Bot Token（必須）- 請從 Discord Developer Portal 取得
  // 建議使用環境變數：process.env.DISCORD_TOKEN
  token: process.env.DISCORD_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  
  // 應用程式 ID（必須）- 用於註冊 Slash 指令
  // 建議使用環境變數：process.env.DISCORD_APPLICATION_ID
  applicationId: process.env.DISCORD_APPLICATION_ID || 'YOUR_APPLICATION_ID_HERE',
  
  // 伺服器 ID（可選）- 指定則僅在該伺服器註冊指令，留空則全域註冊
  // 建議使用環境變數：process.env.DISCORD_GUILD_ID
  guildId: process.env.DISCORD_GUILD_ID || '',
  
  // 頻道 ID（可選）- 指定則僅監聽該頻道，留空則全域監聽
  // 建議使用環境變數：process.env.DISCORD_CHANNEL_ID
  channelId: process.env.DISCORD_CHANNEL_ID || '',
  
  // 擁有者使用者 ID（建議設定）- 用於 DM 權限控制
  // 建議使用環境變數：process.env.DISCORD_USER_ID
  userId: process.env.DISCORD_USER_ID || 'cookice',
  
  // Client 設定 - 一般情況下不需要修改
  intents: [
    // 必要的 Intent 權限
    'Guilds',
    'GuildMessages', 
    'DirectMessages',
    'MessageContent'
  ]
};