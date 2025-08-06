# Demon 專案日誌系統文件

## 概述

本文件描述 Demon 專案的完整日誌記錄系統，包括錯誤處理、敏感資訊過濾、和全域異常監控。此系統設計用於生產環境的穩定運行和問題診斷。

## 系統架構

### 核心組件

1. **Logger 類別** (`src/utils/logger.js`)
   - 多檔案日誌記錄
   - 自動日誌壓縮與清理
   - 敏感資訊過濾
   - 可配置的控制台輸出

2. **GlobalErrorHandler** (`src/utils/globalErrorHandler.js`)
   - 全域未捕獲例外監控
   - Promise 拒絕處理
   - 程序警告監控
   - 錯誤上下文記錄

3. **ErrorDemoModule** (`src/utils/errorDemo.js`)
   - 錯誤處理示範
   - I/O 失敗場景
   - API 超時場景
   - 敏感資訊過濾測試

## 使用指南

### 基本日誌記錄

```javascript
const Logger = require('./utils/logger');
const logger = new Logger('module-name.log');

// 不同級別的日誌
logger.info('資訊訊息');
logger.warn('警告訊息');
logger.error('錯誤訊息');
logger.Original('原始格式訊息');
```

### 全域錯誤處理初始化

```javascript
const GlobalErrorHandler = require('./utils/globalErrorHandler');

// 在應用程序入口處初始化
GlobalErrorHandler.init({
    logFileName: 'global-errors.log',  // 可選，預設為 'global-errors.log'
    exitOnUncaught: false              // 可選，預設為 false
});
```

### 敏感資訊過濾

系統自動過濾以下類型的敏感資訊：

- **Token**: `token: abc123...` → `token: abc***`
- **API Key**: `api_key=sk-123...` → `api_key=sk-***`
- **Password**: `password: secret` → `password: sec***`
- **Email**: `user@example.com` → `use***`
- **信用卡號**: `1234-5678-9012-3456` → `123***`
- **Bearer Token**: `Bearer eyJhbG...` → `Bearer eyJ***`

#### 手動檢查敏感資訊

```javascript
const Logger = require('./utils/logger');

if (Logger.hasSensitiveInfo(message)) {
    logger.warn('訊息包含敏感資訊');
}
```

## 日誌檔案結構

### 目錄結構

```
logs/
└── 2024-01-15T10-30-00-000Z/          # 當前執行的日誌目錄
    ├── global-errors.log              # 全域錯誤日誌
    ├── LlamaServerManager.log         # 各模組日誌
    ├── LlamaRemote.log
    └── error-demo.log
```

### 日誌格式

```
2024-01-15T10:30:15.123Z - INFO - 正常資訊訊息
2024-01-15T10:30:16.456Z - WARN - 警告訊息
2024-01-15T10:30:17.789Z - ERROR - 錯誤訊息
2024-01-15T10:30:18.012Z - ORIGINAL - 原始格式訊息
```

## 配置選項

### Logger 配置

```javascript
const Logger = require('./utils/logger');

// 設定日誌基礎路徑
Logger.SetLoggerBasePath('/custom/log/path');

// 開啟/關閉控制台輸出
Logger.SetConsoleLog(true);  // 開啟
Logger.SetConsoleLog(false); // 關閉
```

### GlobalErrorHandler 配置

```javascript
GlobalErrorHandler.init({
    logFileName: 'custom-errors.log',  // 自訂錯誤日誌檔名
    exitOnUncaught: true               // 遇到未捕獲例外時退出程序
});
```

## 錯誤處理最佳實踐

### 1. 同步操作錯誤處理

```javascript
try {
    const data = JSON.parse(jsonString);
    logger.info('JSON 解析成功');
} catch (error) {
    logger.error(`JSON 解析失敗: ${error.message}`);
    // 處理錯誤邏輯
}
```

### 2. 異步操作錯誤處理

```javascript
async function processData() {
    try {
        const data = await fs.readFile('data.txt', 'utf8');
        logger.info('檔案讀取成功');
        return data;
    } catch (error) {
        logger.error(`檔案讀取失敗: ${error.message}`);
        throw error; // 重新拋出讓上層處理
    }
}
```

### 3. API 請求錯誤處理

```javascript
async function callAPI(url) {
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
        try {
            const response = await axios.get(url, { timeout: 5000 });
            logger.info('API 請求成功');
            return response.data;
        } catch (error) {
            retryCount++;
            logger.warn(`API 請求失敗 (嘗試 ${retryCount}/${maxRetries}): ${error.message}`);
            
            if (retryCount >= maxRetries) {
                logger.error('API 請求達到最大重試次數');
                throw error;
            }
            
            // 指數退避延遲
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        }
    }
}
```

### 4. 使用 GlobalErrorHandler 包裝函數

```javascript
const safeAsyncFunction = GlobalErrorHandler.wrapAsync(async (param) => {
    // 可能拋出錯誤的異步操作
    return await riskyOperation(param);
}, { module: 'MyModule', operation: 'riskyOperation' });
```

## 監控和維護

### 日誌檔案監控

- 日誌檔案自動按執行時間建立目錄
- 舊日誌在壓縮後即刪除壓縮檔，避免累積佔用空間

### 錯誤分析

1. **檢查全域錯誤日誌** (`global-errors.log`)
   - 查看未捕獲例外
   - 查看未處理的 Promise 拒絕
   - 查看系統警告

2. **檢查模組特定日誌**
   - 每個模組有獨立的日誌檔案
   - 可快速定位特定功能的問題

3. **敏感資訊檢查**
   - 所有日誌都經過敏感資訊過濾
   - 可安全地分享日誌進行問題診斷

## 測試和驗證

### 運行錯誤處理示範

```javascript
const ErrorDemoModule = require('./utils/errorDemo');

// 運行所有示範
await ErrorDemoModule.runAllDemonstrations();

// 單獨測試 I/O 錯誤
await ErrorDemoModule.demonstrateIOErrors();

// 單獨測試 API 超時
await ErrorDemoModule.demonstrateAPITimeouts();

// 測試敏感資訊過濾
ErrorDemoModule.demonstrateSensitiveInfoFiltering();
```

### 測試全域錯誤處理

```javascript
// 測試未捕獲例外 (謹慎使用)
ErrorDemoModule.demonstrateUncaughtException();

// 測試未處理的 Promise 拒絕
ErrorDemoModule.demonstrateUnhandledRejection();
```

## 版本發布前檢查清單

在每次版本發布前，請確認以下項目：

- [ ] 全域錯誤處理器已在所有入口點初始化
- [ ] 所有模組都使用適當的 Logger 實例
- [ ] 敏感資訊過濾功能正常運作
- [ ] 錯誤處理示範通過測試
- [ ] 日誌檔案可正常生成和壓縮
- [ ] 控制台輸出開關功能正常
- [ ] 檢查日誌中無敏感資訊洩漏

## 效能考慮

- 日誌寫入採用異步方式，不阻塞主流程
- 敏感資訊過濾使用正規表達式，對效能影響較小
- 日誌壓縮在背景執行，不影響程序啟動
- 建議在生產環境關閉不必要的控制台輸出

## 故障排除

### 常見問題

1. **日誌檔案無法建立**
   - 檢查目錄權限
   - 確認磁碟空間充足

2. **敏感資訊過濾不生效**
   - 檢查過濾規則是否符合實際格式
   - 考慮添加自訂過濾規則

3. **全域錯誤處理器未生效**
   - 確認在程序入口處已正確初始化
   - 檢查是否有多次初始化的警告

4. **日誌檔案過大**
   - 調整日誌級別
   - 增加日誌輪轉頻率
   - 清理舊的壓縮日誌

---

**最後更新**: 2025-07-31  
**版本**: 1.0.0  
**維護者**: Demon 開發團隊
