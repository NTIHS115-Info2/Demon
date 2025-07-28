#### discord插件更新紀錄

### [pb.v.0.1]
## New
- 新增 Discord 插件並撰寫測試檔案

### [pb.v.0.1.1]
## Improve
- 調整 Discord 插件 send 方法，可傳入 func 以呼叫內部功能

### [pb.v.0.1.2]
## Docs
- 新增 send.md，說明 send 輸入及用法

### [pb.v.0.1.3]
## Change
- Discord 插件加入策略入口與 `priority`，相容新版 pluginsManager

### [pb.v.0.1.4]
## Update
- MessageHandler 支援私訊、提及與回覆，整合 TalkToDemon
- 限制僅回應指定使用者，其他人回覆「我還學不會跟別人說話」

### [pb.v.0.1.5]
## Update
- 調整 MessageHandler 依句號即時推送回覆，保留標點符號
- 強化錯誤處理與註解

### [pb.v.0.1.6]
## New
- 新增 Discord `config.js` 統一管理 Token 與頻道等設定
## Update
- 各檔案改為讀取 `config.js` 作為預設值
- 更新文件說明

### [pb.v.0.1.7]
## Change
- 改為全域監聽所有伺服器與頻道，可選擇以 channelId 限制
- `commandHandler` 支援無 guildId 時註冊為全域 Slash 指令
- 更新文件說明

### [pb.v.0.1.8]
## Fix
- 修復DM訊息無法使用問題
## Change
- 將其他人的對話也納入回應範圍