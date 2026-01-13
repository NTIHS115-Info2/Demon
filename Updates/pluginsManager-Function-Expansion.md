#### pluginsManager 功能擴充更新紀錄

### [v1.0]
## New
- 新增 `SetExceptionLLMTool`，可設定不需啟動的 LLM 插件清單
- 新增 `StartLLMTool`，啟動除例外清單外的所有 LLM 插件並回傳啟動與跳過結果

### [v1.1]
## Change
- 導入 `setting.json` 外部設定檔，統一管理插件名稱、優先度與類型
- 調整 PluginsManager 載入流程，支援掃描、驗證、登錄與延後啟動的四階段機制
- 新增插件註冊索引與錯誤紀錄，強化設定檔異常處理與日誌可讀性
- StartLLMTool 與相關流程改為依賴註冊資訊動態載入插件，避免不必要的初始化成本

### [v1.2]
## Change
- 掃描程序改為回傳總數、已登錄與無效統計，並在重新掃描時清理遺失目錄的快取與註冊紀錄
- 新增無效插件追蹤表與 `getInvalidPlugins()` 查詢接口，集中記錄設定錯誤的目錄與原因
- 調整設定驗證流程，統一於錯誤處拋出異常並由登錄層統一記錄，避免重複日誌
- 更新插件規範文件，明確說明 `setting.json` 欄位定義與 PluginsManager 掃描流程

### [v1.3]
## Change
- 新增 Express app 注入與取得機制，提供插件統一註冊路由的入口
