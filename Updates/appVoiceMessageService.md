#### appVoiceMessageService 插件更新紀錄

## [v0.2]
### Changed
- 調整 online 流程改用主服務注入的 Express app 註冊路由，避免誤建立新服務
- 補強重複上線與路由掛載錯誤處理，並保留 app 實例檢查提示

## [v0.1]
### New
- 新增 appVoiceMessageService 插件，提供 App 語音訊息完整管線入口
- 完成 ASR → LLM → TTS → 轉碼流程的模組化設計與錯誤回應
- 加入追蹤 ID、耗時統計與暫存檔清理機制
- 補齊對外 HTTP 路由與 API 文件
