# ASR 語音辨識插件增強功能

## 概述

本次更新主要針對 ASR (Automatic Speech Recognition) 插件的錯誤處理、超時管理和日誌記錄進行了全面增強，確保系統在各種網路狀況和錯誤場景下都能穩定運行。

## 主要增強功能

### 1. 超時處理機制

#### Remote 策略超時增強
- **狀態查詢超時**: 設定 5 秒超時限制
- **指令執行超時**: 設定 10 秒超時限制
- **連線超時檢測**: 自動識別 `ECONNABORTED` 錯誤

#### Server 策略超時保護
- **請求超時保護**: 30 秒自動超時機制
- **操作執行計時**: 記錄每個操作的執行時間
- **超時自動回應**: 超時時自動回傳 500 錯誤

### 2. 錯誤分類與處理

#### HTTP 狀態碼分類處理
- **500+ 錯誤**: 伺服器內部錯誤
- **400-499 錯誤**: 用戶端請求錯誤
- **408 錯誤**: 專門處理超時情況

#### 錯誤類型識別
- `connection_error`: 連線錯誤 (ECONNREFUSED)
- `timeout_error`: 超時錯誤 (408 狀態碼)
- `not_found_error`: 資源未找到 (404 狀態碼)
- `internal_error`: 內部錯誤 (500 狀態碼)

### 3. 詳細日誌記錄

#### 執行時間追蹤
```javascript
// 範例日誌輸出
[ASRRemote] start 執行成功 (耗時 1250ms)
[ASRServer] restart 執行失敗 (timeout_error): 操作逾時 (耗時 30001ms)
```

#### 錯誤情境記錄
- 連線失敗詳細信息
- HTTP 狀態碼和錯誤訊息
- 操作執行時間統計

### 4. HTTP API 回應增強

#### 成功回應格式
```json
{
  "success": true,
  "message": "ASR 已啟動",
  "duration_ms": 1250,
  "timestamp": "2024-01-01T10:30:00.000Z"
}
```

#### 錯誤回應格式
```json
{
  "error": "timeout_error",
  "message": "操作逾時",
  "action": "start", 
  "duration_ms": 30001,
  "timestamp": "2024-01-01T10:30:30.000Z"
}
```

#### 404 錯誤回應
```json
{
  "error": "未找到操作",
  "message": "未知的 ASR 操作：unknown",
  "available_actions": ["start", "stop", "restart", "state"]
}
```

## 使用方式

### 1. 本地模式
```javascript
const asr = require('./src/plugins/asr');

// 啟動本地 ASR
await asr.updateStrategy('local');
await asr.online({
  deviceId: 1,
  model: 'large-v3',
  sliceDuration: 4
});
```

### 2. 遠端模式
```javascript
// 設定遠端伺服器
await asr.updateStrategy('remote', {
  baseUrl: 'https://your-asr-server.com'
});

// 發送指令
try {
  await asr.send('start');
} catch (error) {
  // 自動處理超時和連線錯誤
  console.error('ASR 指令執行失敗:', error.message);
}
```

### 3. 伺服器模式
```javascript
// 啟動伺服器模式（含 ngrok 整合）
await asr.updateStrategy('server');
await asr.online();

// HTTP 路由自動註冊：
// POST /asr/start   - 啟動 ASR
// POST /asr/stop    - 停止 ASR  
// POST /asr/restart - 重啟 ASR
// GET  /asr/state   - 查詢狀態
```

## HTTP 路由詳細說明

### 狀態查詢 (GET /asr/state)
```bash
curl https://your-ngrok-url.ngrok.io/asr/state
```

回應:
```json
{
  "state": 1,
  "duration_ms": 45,
  "timestamp": "2024-01-01T10:30:00.000Z"
}
```

### 操作執行 (POST /asr/{action})
```bash
# 啟動 ASR
curl -X POST https://your-ngrok-url.ngrok.io/asr/start

# 停止 ASR  
curl -X POST https://your-ngrok-url.ngrok.io/asr/stop

# 重啟 ASR
curl -X POST https://your-ngrok-url.ngrok.io/asr/restart
```

## 錯誤處理範例

### 超時處理
```javascript
try {
  await remoteStrategy.send('start');
} catch (error) {
  if (error.message.includes('逾時')) {
    console.log('操作超時，請檢查網路連線');
  }
}
```

### 連線錯誤處理
```javascript
try {
  const state = await remoteStrategy.state();
} catch (error) {
  if (error.message.includes('連接')) {
    console.log('無法連接到遠端伺服器');
  }
}
```

## 測試覆蓋

新增了全面的測試覆蓋：

1. **超時場景測試**: 驗證各種超時情況的處理
2. **錯誤回應測試**: 驗證 HTTP 狀態碼和錯誤訊息
3. **執行時間測試**: 驗證時間統計功能
4. **策略選擇測試**: 驗證自動故障轉移

執行測試：
```bash
npm test asrEnhanced.test.js
npm test asrServerError.test.js
```

## 相容性

本次更新完全向後相容，不影響現有功能：

- ✅ 現有 API 介面保持不變
- ✅ 原有配置參數仍然有效
- ✅ 策略選擇邏輯保持一致
- ✅ Python 腳本整合無變化

## 效能影響

- 新增的錯誤處理和日誌記錄對效能影響極小
- 超時機制可防止資源洩漏
- 詳細的執行時間統計有助於效能監控