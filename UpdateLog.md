### [v.0.1]
## New
- 初始化架構
- 成功搬運logger，並重構部分細節
- 將llama.cpp(nodejs接口)
## Todo
- 逐漸複製Angel的部分有用插件到這

### [v.0.1.1]
## New
- llama.cpp 的測試文件
## Fix
- llama.cpp 的運行判定，以及部分檔案位置指定錯誤

### [v.0.2]
## New
- 撰寫fileReader 與 測試腳本， fileReader隸屬於tools內
- 撰寫PromptComposer 與 預設系統提示詞功能測試腳本
- logger增加Original功能，可以讓logger輸出原態
- logger增加UseConsole功能，可以選擇是否要使用logger內部的console.log輸出，預設關閉
## Fix
- logger的防呆機制，確保每個log檔案的.log副檔名被加入

### [v.0.2.1]
## Fix
- 更新測試檔案名稱，讓其更符合測試內容

### [v.0.3]
## New
- 新的工具規範與架構
- 重新撰寫內部文件編輯器，以便適應新的工具規範
## Delete
- 刪除了舊的內部文件編輯系統以及測試檔案

### [v.0.3.1]
## Fix
- Bug修復

### [v.0.4]
## New
- 將logger轉移到utils下，更符合其定位
- llama的ServerManager細部實作改為async
- 建立plugins的插件架構規範
- 建立TalkToDemon
- 建立PluginsManager
- 引入jest測試方式
- 將所有測試改為jest

### [v.0.5a]
## New
- 新增ASR和TTS插件，不過是還未依照插件規範設計的，等待後續v0.5版修改

### [v.0.5]
## New
- 將 ASR 與 TTS 插件重構為符合插件規範的架構，修正路徑並補充錯誤處理
- 新增 SpeechBroker 插件，負責將 Demon 串流輸出轉送至 TTS
## Fix
- 修正 ToDo 與 UpdateLog 尾端誤植字串

### [v.0.5.1]
## Test
- 新增 ASR、TTS 與 SpeechBroker 插件測試，模擬 PythonShell 與事件流程
## Fix
- 修正插件策略檔引用 utils 路徑錯誤

### [v.0.5.2]
## Move
- 移動新增插件的index.py到正確位址

### [v.0.5.3]
## Fix
- 修復ASR/TTS插件無法正常啟動問題
### [v.0.5.4]
## New
- 新增 ngrok 監控腳本，可自動啟動並監測 3000 端口
## Update
- ToDo 完成 ngrok 相關項目

### [v.0.6]
## Update
- 新增 ngrok 啟動腳本並支援自訂指令
- 強化標準輸出日誌處理

### [v.0.6.1]
## New
- ngrokServer 新增子網域註冊功能，可將外部請求導向對應插件
- 新增 ngrok 插件並整合至 pluginsManager
## Change
- 移除舊的 Server/ngrok/index.js 啟動方式

### [v.0.6.2]
## Update
- 插件註冊子網域改採物件傳入，並新增解註冊功能
- ngrokServer 解除子網域時增加檢查與日誌

### [v.0.6.3]
## Change
- 移除 ngrok 插件額外的 register/unregister 介面
- send() 取代註冊與解註冊行為並加入錯誤處理

### [v.0.6.4]
## Docs
- 新增 ngrok 插件 options.md，說明各接口傳入的 options 內容

### [v.0.7]
## New
- 實作 LlamaServer 遠端與伺服器策略
- 新增 remote/infor.js 儲存子網域設定
- 新增 ASR 與 TTS 插件的 remote 與 server 策略
- remote/infor.js 提供子網域與接口資訊
- PluginsManager 支援插件優先度機制，加入 `priority` 欄位
- queueOnline 增加重複上線檢查
- 所有插件新增 `priority` 屬性
## Change
- LlamaServer 插件可依 mode 切換 local、remote、server 三種策略
- ASR、TTS 插件可依 mode 切換 local、remote、server 三種策略
## Test
- 補充 PluginsManager 測試，驗證排序與防呆邏輯
## Docs
- 更新 regulation.md 與 ToDo.md


### [v.0.7.1]
## Change
- 將各插件的 `priority` 移至 `strategies/index.js` 定義
- 插件根目錄改為從 strategies 引入優先度
- 更新 regulation 說明

### [v.0.7.2]
## Change
- 將 `priority` 下放至各策略實作的 `index.js`
- 更新所有插件以從所選策略讀取優先度
- 調整文件說明與 ToDo

### [v.0.7.3]
## Fix
- 補上遠端策略遺漏的 infor.js 檔案
- 修正 LlamaServerManager 策略切換邏輯
## Test
- 新增 ASR、TTS、LlamaServer 遠端策略單元測試

### [v.0.7.4]
## Fix
- 移除多餘的 remote/infor.js，改由 server 策略提供設定
- 修正 TTS 插件策略切換錯誤
## Change
- ASR、TTS 策略 index.js 匯出三種策略
- 整理三個插件根目錄 index.js，統一策略載入邏輯

### [v.0.8]
## New
- 新增 OsInfor 工具，提供 table 與 get 兩種接口
- ASR、TTS、LlamaServer 插件支援自動選擇策略
- 各策略補上 priority 欄位並新增 serverInfo 判定
## Test
- 新增 OsInfor 與 TTS updateStrategy 測試

### [v.0.8.1]
## New
- 更新__test__/old 用來存放舊的測試### pb = plugins branch

### [v.0.9]
## New
- discord插件（更新記錄視下方）

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

### tools branch
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
