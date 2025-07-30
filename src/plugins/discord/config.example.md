# Discord Bot 設定說明

## 環境變數設定

建議使用環境變數來設定敏感資訊，避免將 Token 直接寫在程式碼中：

```bash
export DISCORD_TOKEN="your_bot_token_here"
export DISCORD_APPLICATION_ID="your_application_id_here"
export DISCORD_GUILD_ID="your_guild_id_here"  # 可選，留空則全域註冊指令
export DISCORD_CHANNEL_ID="your_channel_id_here"  # 可選，留空則監聽所有頻道
export DISCORD_USER_ID="your_user_id_here"  # 建議設定，用於 DM 權限控制
```

## 取得 Discord Bot 資訊

1. **建立 Discord 應用程式**
   - 前往 [Discord Developer Portal](https://discord.com/developers/applications)
   - 點擊 "New Application" 建立新應用程式
   - 複製 `Application ID`

2. **建立 Bot**
   - 在應用程式頁面點擊 "Bot" 選單
   - 點擊 "Add Bot" 建立機器人
   - 複製 `Token`（注意：Token 是敏感資訊，請勿洩露）

3. **設定權限**
   - 在 "Bot" 頁面設定必要權限：
     - Send Messages
     - Use Slash Commands
     - Read Message History
     - Mention Everyone（如需要）

4. **邀請 Bot 到伺服器**
   - 點擊 "OAuth2" > "URL Generator"
   - Scopes 選擇：`bot` 和 `applications.commands`
   - Bot Permissions 選擇對應權限
   - 使用生成的 URL 邀請 Bot

## config.js 設定範例

```javascript
module.exports = {
  // Bot Token（必須）
  token: process.env.DISCORD_TOKEN || '',
  
  // 應用程式 ID（必須，用於註冊 Slash 指令）
  applicationId: process.env.DISCORD_APPLICATION_ID || '',
  
  // 伺服器 ID（可選，指定則僅在該伺服器註冊指令）
  guildId: process.env.DISCORD_GUILD_ID || '',
  
  // 頻道 ID（可選，指定則僅監聽該頻道）
  channelId: process.env.DISCORD_CHANNEL_ID || '',
  
  // 擁有者使用者 ID（建議設定，用於 DM 權限控制）
  userId: process.env.DISCORD_USER_ID || 'cookice'
};
```

## 安全注意事項

1. **Token 保護**：絕對不要將 Bot Token 提交到版本控制系統
2. **環境變數**：使用環境變數來儲存敏感資訊
3. **權限最小化**：只給予 Bot 必要的權限
4. **日誌安全**：系統會自動過濾日誌中的敏感資訊