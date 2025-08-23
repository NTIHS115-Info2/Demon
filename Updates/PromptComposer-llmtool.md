### PromptComposer-llmtool 
### [dev0.1]
## New
- 新增 MockPlugin 與 ToolReferencePlugin
- 新增 toolOutputRouter 模組
- PluginsManager 支援 LLM 插件查詢
- TalkToDemon 整合工具輸出並加入忙碌狀態
## Test
- 新增 toolOutputRouter 單元測試

### [dev0.2]
## Update
- MockPlugin 支援失敗與逾時模式
- toolOutputRouter 移除 user 分流，統一回注 LLM 並新增逾時處理
- 新增 promptComposer 錯誤處理與單元測試
- 補充 tool-description.json 標準格式文件與流程圖
## Test
- 新增 promptComposer 與 toolOutputRouter 測試

### [dev0.3]
## Change
- toolOutputRouter 改為串流檢測 JSON，一旦發現即中斷並執行工具
- TalkToDemon 對應更新，避免輸出工具 JSON
## Docs
- 更新 toolFlow 與 toolOutputRouter 說明

### [dev0.4]
## Update
- toolOutputRouter 改為事件式解析，支援未完成 JSON 緩存
- TalkToDemon 移除即時中止，改為串流結束後再執行工具
- 工具歷史在回覆完畢後自動清除
## Delete
- 移除 mockPlugin 範例插件
## Docs
- 修訂流程圖與 router 說明文字

### [dev0.5]
## Update
- PromptComposer 新增 composeMessages 與 createToolMessage
- TalkToDemon 透過 composeMessages 重組提示詞並寫入工具訊息
- toolOutputRouter 回傳工具訊息物件
## Fix
- routeOutput 支援解析工具訊息物件

### [dev0.6]
## Change
- history 維持原本僅記錄 user 與 assistant
- 工具訊息於 PromptComposer 處理，不再寫入 history
## Update
- toolReference pluginType 改為 LLM
- 還原 llamaServer 的外層設定

### [dev0.7]
## Update
- 新增 toolResultBuffer 陣列，由 toolOutputRouter 透過事件更新
- TalkToDemon 改用 waitingForTool 旗標，busy 狀態移除
- composeMessages 支援工具歷史陣列
## Test
- 更新 toolOutputRouter 測試，調整參數名稱

### [dev0.8]
## Change
- ToolReference 插件依規範重構為策略化，新增 local 策略
## Fix
- 加入錯誤處理避免讀取工具說明時崩潰

### [dev0.9]
## Update
- toolOutputRouter 支援插件錯誤回傳，統一回注 `success: false` 與 `error`
- PromptComposer 補充錯誤內容與可選 value 顯示
- 更新 LLM 規範文件說明錯誤格式
## Test
- 新增插件錯誤回傳單元測試