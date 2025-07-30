# 設定檔與資料儲存系統

本專案已實施完整的設定檔管理與資料儲存系統，滿足以下需求：

## ✅ 已實現功能

### 1. Discord／OpenAI／llama 等 config 讀取
- **Discord 設定檔**: `src/plugins/discord/config.js`
  - 自動驗證必要欄位 (token, applicationId, guildId, channelId)
  - 型別檢查與空值驗證
  - 缺少設定檔時自動創建範例檔案

- **Llama 設定檔**: `Server/llama/settings/*.json`
  - 驗證模型檔案路徑是否存在
  - 參數範圍驗證 (port, threads, context size 等)
  - 支援的模型格式驗證 (.gguf, .ggml, .bin)

- **Ngrok 設定檔**: `config/ngrok.js`
  - 執行檔路徑驗證
  - 端口範圍檢查
  - authtoken 設定支援

### 2. 缺值即時報錯，不用空值運行
- 所有設定檔在載入時進行嚴格驗證
- 空字串、null、undefined 都會被視為無效值
- 明確的錯誤訊息指出缺少的欄位
- 應用程式在設定檔無效時拒絕啟動

### 3. history/ JSON 檔裁剪與滾動
- **自動裁剪**: 預設保留 100 條訊息，7 天內的記錄
- **檔案輪轉**: 檔案大小超過 1MB 時自動備份
- **備份管理**: 保留 3 個備份檔案，自動清理過期備份
- **可配置**: 透過 `config/history.js` 調整所有參數

### 4. 執行路徑、模型檔、ngrok.exe 存在驗證
- **Llama 執行檔**: 驗證 `llama-server.exe` 是否存在
- **模型檔案**: 驗證所有 `.gguf/.ggml/.bin` 模型檔案路徑
- **Ngrok 執行檔**: 驗證 `ngrok.exe` 路徑
- **即時檢查**: 在應用程式啟動時立即驗證所有路徑

### 5. 範例設定檔移除或標示需填值
- 所有範例設定檔使用 `請填入...` 標記需要填寫的值
- 範例檔案包含詳細的註解說明
- 自動創建機制：缺少設定檔時自動生成範例
- 清楚的設定指南和錯誤提示

## 📁 檔案結構

```
src/utils/configManager.js          # 核心設定檔管理器
src/plugins/discord/
├── config.example.js               # Discord 範例設定檔
├── configLoader.js                 # Discord 設定檔載入器
└── config.js                       # Discord 實際設定檔 (gitignore)

Server/llama/
├── configValidator.js              # Llama 設定檔驗證器
└── settings/*.json                  # Llama 設定檔

config/
├── history.example.js              # History 管理器範例設定
└── ngrok.example.js                # Ngrok 範例設定 (自動創建)

src/core/historyManager.js          # 增強版歷史管理器
```

## 🔧 使用方式

### Discord 設定
1. 複製 `src/plugins/discord/config.example.js` 為 `config.js`
2. 填入有效的 Discord Bot 資訊
3. 所有標示 `請填入...` 的值都必須設定

### Llama 設定
1. 檢查 `Server/llama/settings/` 中的 JSON 檔案
2. 更新 `modelPath` 為實際的模型檔案路徑
3. 確認 `llama-server.exe` 存在

### History 設定
1. 可選：複製 `config/history.example.js` 為 `history.js`
2. 調整訊息保留數量、過期時間等參數
3. 不設定則使用預設值

## 🛡️ 驗證機制

- **必要欄位檢查**: 確保所有必需的設定項目都存在
- **型別驗證**: 檢查字串、數字、布林值等型別
- **數值範圍**: 驗證端口號、執行緒數等參數範圍
- **檔案路徑**: 確認執行檔和模型檔案實際存在
- **空值拒絕**: 拒絕空字串、null、undefined 等無效值

## 🧪 測試

```bash
# 執行所有相關測試
npm test

# 測試特定功能
npx jest historyManager.test.js
npx jest discordPlugin.test.js
npx jest configIntegration.test.js
```

## 📋 設定檔範例

詳見各個 `.example.js` 檔案，包含完整的設定說明和範例值。