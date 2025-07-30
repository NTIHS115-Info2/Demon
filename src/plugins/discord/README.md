# Discord 插件

Discord 介接插件，提供完整的 Discord Bot 功能，包含訊息監聽、指令處理和錯誤處理。

## 功能特色

### ✅ Bot 登入/登出流程與 Token 驗證
- 完整的客戶端生命週期管理
- Token 有效性驗證
- 自動重連機制
- 安全的錯誤處理（不洩露敏感資訊）

### ✅ 三種訊息監聽模式
1. **DM（直接訊息）**：支援與擁有者的私人對話
2. **@提及**：響應在群組中的 @ 提及
3. **回覆訊息**：處理對 Bot 訊息的回覆

### ✅ Slash 指令系統
- `/ping` 指令檢查 Bot 狀態
- 支援 Guild 和全域指令註冊
- 完整的指令錯誤處理
- 可擴展的指令系統

### ✅ 強化的錯誤處理
- `send()` 和 `restart()` 呼叫錯誤處理
- 自動重試機制
- 優雅的降級處理
- 詳細的操作日誌

### ✅ 日誌安全性
- 自動過濾敏感資訊（Token、密鑰等）
- 結構化日誌記錄
- 分級日誌管理（INFO/WARN/ERROR）

## 設定方式

1. **建立設定檔**：
   - 複製 `config.template.js` 為 `config.js`
   - 參考 `config.example.md` 填入正確的 Discord Bot 設定
2. **環境變數**：使用環境變數儲存敏感資訊
3. **權限設定**：確保 Bot 有適當的 Discord 權限

⚠️ **注意**：`config.js` 檔案包含敏感資訊，已被 `.gitignore` 排除，請勿提交到版本控制。

## 使用方式

### 外部呼叫 send 方法
詳細參數請參考 `send.md` 文件：

```javascript
// 發送訊息
pluginManager.send('discord', {
  func: 'send',
  channelId: '頻道ID',
  message: '要發送的訊息'
});

// 重啟 Bot
pluginManager.send('discord', {
  func: 'restart',
  token: '新的Token'  // 可選
});
```

## 架構說明

插件採用策略模式設計，目前提供 `local` 策略：

- `clientManager.js`：Discord 客戶端管理
- `messageHandler.js`：訊息處理邏輯
- `commandHandler.js`：Slash 指令處理
- `config.js`：Bot 設定檔

## 測試

執行 Discord 插件測試：
```bash
npm test -- --testNamePattern="Discord"
```
