# toolOutputRouter 使用規範

此文件說明 LLM 工具輸出需遵循的 JSON 格式以及錯誤處理邏輯。

自 v0.7 起，router 以事件方式逐段檢測 LLM 回傳。
解析到一般文字即立即推送，若偵測到完整 JSON，則等待串流結束後執行工具，
完成後把工具結果以 `role: tool` 注入並重新呼叫 LLM。

## 錯誤處理
- JSON 格式錯誤或欄位缺失時，toolOutputRouter 會視為一般回覆並原樣輸出。
- 找不到對應工具或執行逾時時，會將失敗狀態注入 PromptComposer，再交由 LLM 處理。