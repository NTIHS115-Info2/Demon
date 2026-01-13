# App Voice Message Service

## 插件概述

appVoiceMessageService 是一個處理 iOS/App 端語音訊息的插件，負責：
1. 接收語音檔案上傳
2. 調用 ASR 插件進行語音轉文字
3. 調用 LLM 產生回覆
4. 調用 TTS 插件產生語音回覆
5. 回傳音訊串流給客戶端

## 插件架構

```
appVoiceMessageService/
├── setting.json          ← 插件設定（name, priority, pluginType）
├── index.js              ← 插件主入口（策略調度）
├── docs.md               ← 說明文件
└── strategies/
    ├── index.js          ← 策略匯出
    └── local/
        ├── index.js              ← local 策略實作
        └── VoiceMessagePipeline.js ← 語音處理管線
```

## 使用方式

### 1. 透過 PluginsManager 啟動

```javascript
const pluginsManager = require('./src/core/pluginsManager');
const express = require('express');

const app = express();

// 初始化插件管理器
await pluginsManager.init();

// 啟動 appVoiceMessageService 插件
await pluginsManager.online('appvoicemessageservice', {
  expressApp: app,  // 必須：注入 Express app 以掛載路由
  mode: 'local'     // 選填：策略模式，預設 'local'
});

// 啟動伺服器
app.listen(3000, () => {
  console.log('Server started on port 3000');
});
```

### 2. 直接使用插件

```javascript
const appVoiceMessageService = require('./src/plugins/appVoiceMessageService');
const express = require('express');

const app = express();

// 直接啟動插件
await appVoiceMessageService.online({
  expressApp: app
});

app.listen(3000);
```

### 3. 插件控制

```javascript
// 查詢狀態
const state = await pluginsManager.getState('appvoicemessageservice');
// state: 1 = 在線, 0 = 離線, -1 = 錯誤

// 離線
await pluginsManager.offline('appvoicemessageservice');

// 重啟
await pluginsManager.restart('appvoicemessageservice', {
  expressApp: app
});
```

## API 端點

### POST /ios/BubbleChat

語音對話主要端點。

#### 請求格式
```bash
curl -X POST "http://localhost:3000/ios/BubbleChat" \
  -H "X-App-Client: ios" \
  -F "file=@./sample.m4a" \
  -F "username=app"
```

#### 參數說明
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| file | File | 是 | 音訊檔案（支援 wav, m4a, mp3, ogg, webm, flac） |
| username | string | 是 | 使用者識別碼（英數字、底線、點、連字號，1-64 字元） |

#### Response Headers
| Header | 說明 |
|--------|------|
| X-Trace-Id | 請求追蹤編號 |
| X-Turn-Id | 對話回合識別碼 |
| X-ASR-Duration-Ms | ASR 語音轉文字耗時 |
| X-LLM-Duration-Ms | LLM 回覆產生耗時 |
| X-TTS-Duration-Ms | TTS 語音合成耗時 |
| X-Transcode-Duration-Ms | 音訊轉碼耗時 |

#### 成功回應
- **Content-Type**: `audio/m4a`
- **Body**: m4a 音訊串流

#### 失敗回應
```json
{
  "trace_id": "01HXXXXXXXXXXXXXX",
  "error": {
    "code": "ASR_FAILED",
    "message": "語音轉文字失敗",
    "details": "詳細錯誤訊息"
  }
}
```

### GET /ios/HealthCheck

健康檢查端點。

#### 請求
```bash
curl "http://localhost:3000/ios/HealthCheck"
```

#### 回應
```json
{
  "status": "ok"
}
```

## 錯誤代碼

| Code | 說明 |
|------|------|
| MISSING_FILE | 未上傳檔案 |
| UNSUPPORTED_FORMAT | 不支援的音訊格式 |
| FILE_NOT_FOUND | 檔案處理失敗 |
| ASR_FAILED | 語音轉文字失敗 |
| LLM_FAILED | LLM 回覆產生失敗 |
| TTS_FAILED | 語音合成失敗 |
| TRANSCODE_FAILED | 音訊轉碼失敗 |
| INTERNAL_ERROR | 內部錯誤 |

## 依賴插件

- **asr**: 語音轉文字
- **ttsArtifact**: 文字轉語音

## 注意事項

1. **Express App 注入**：必須在 `online()` 時提供 `expressApp` 參數
2. **路由只註冊一次**：即使重複呼叫 `online()`，路由也不會重複掛載
3. **離線行為**：`offline()` 只更新狀態，已掛載的路由會持續回應請求
