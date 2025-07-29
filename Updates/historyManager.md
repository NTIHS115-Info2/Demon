#### historyManager
### [dev0.1]
## New
- 新增 historyManager 模組，提供對話歷史持久化與裁剪機制
- TalkToDemon 整合 historyManager，自動注入歷史訊息
## Test
- 新增 historyManager 測試
## Update
- 更新 ToDo 完成對話歷史相關項目
### [dev0.1.1]
## Fix
- 移除多餘的 Discord config.js 範例檔案

### [dev0.1.2]
## Change
- Discord 模組讀取設定檔失敗時將直接拋出錯誤，不再提供預設值
## Test
- 更新測試以模擬設定檔，確保功能正常

