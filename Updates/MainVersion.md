## [v.0.1]
### New
- 初始化架構
- 成功搬運logger，並重構部分細節
- 將llama.cpp(nodejs接口)
### Todo
- 逐漸複製Angel的部分有用插件到這

## [v.0.1.1]
### New
- llama.cpp 的測試文件
### Fix
- llama.cpp 的運行判定，以及部分檔案位置指定錯誤

## [v.0.2]
### New
- 撰寫fileReader 與 測試腳本， fileReader隸屬於tools內
- 撰寫PromptComposer 與 預設系統提示詞功能測試腳本
- logger增加Original功能，可以讓logger輸出原態
- logger增加UseConsole功能，可以選擇是否要使用logger內部的console.log輸出，預設關閉
### Fix
- logger的防呆機制，確保每個log檔案的.log副檔名被加入

## [v.0.2.1]
### Fix
- 更新測試檔案名稱，讓其更符合測試內容

## [v.0.3]
### New
- 新的工具規範與架構
- 重新撰寫內部文件編輯器，以便適應新的工具規範
### Delete
- 刪除了舊的內部文件編輯系統以及測試檔案

## [v.0.3.1]
### Fix
- Bug修復

## [v.0.4]
### New
- 將logger轉移到utils下，更符合其定位
- llama的ServerManager細部實作改為async
- 建立plugins的插件架構規範
- 建立TalkToDemon
- 建立PluginsManager
- 引入jest測試方式
- 將所有測試改為jest

## [v.0.5a]
### New
- 新增ASR和TTS插件，不過是還未依照插件規範設計的，等待後續v0.5版修改

## [v.0.5]
### New
- 將 ASR 與 TTS 插件重構為符合插件規範的架構，修正路徑並補充錯誤處理
- 新增 SpeechBroker 插件，負責將 Demon 串流輸出轉送至 TTS
### Fix
- 修正 ToDo 與 UpdateLog 尾端誤植字串

## [v.0.5.1]
### Test
- 新增 ASR、TTS 與 SpeechBroker 插件測試，模擬 PythonShell 與事件流程
### Fix
- 修正插件策略檔引用 utils 路徑錯誤

## [v.0.5.2]
### Move
- 移動新增插件的index.py到正確位址

## [v.0.5.3]
### Fix
- 修復ASR/TTS插件無法正常啟動問題

## [v.0.5.4]
### New
- 新增 ngrok 監控腳本，可自動啟動並監測 3000 端口
### Update
- ToDo 完成 ngrok 相關項目

## [v.0.6]
### Update
- 新增 ngrok 啟動腳本並支援自訂指令
- 強化標準輸出日誌處理

## [v.0.6.1]
### New
- ngrokServer 新增子網域註冊功能，可將外部請求導向對應插件
- 新增 ngrok 插件並整合至 pluginsManager
### Change
- 移除舊的 Server/ngrok/index.js 啟動方式

## [v.0.6.2]
### Update
- 插件註冊子網域改採物件傳入，並新增解註冊功能
- ngrokServer 解除子網域時增加檢查與日誌

## [v.0.6.3]
### Change
- 移除 ngrok 插件額外的 register/unregister 介面
- send() 取代註冊與解註冊行為並加入錯誤處理

## [v.0.6.4]
### Docs
- 新增 ngrok 插件 options.md，說明各接口傳入的 options 內容

## [v.0.7]
### New
- 實作 LlamaServer 遠端與伺服器策略
- 新增 remote/infor.js 儲存子網域設定
- 新增 ASR 與 TTS 插件的 remote 與 server 策略
- remote/infor.js 提供子網域與接口資訊
- PluginsManager 支援插件優先度機制，加入 `priority` 欄位
- queueOnline 增加重複上線檢查
- 所有插件新增 `priority` 屬性
### Change
- LlamaServer 插件可依 mode 切換 local、remote、server 三種策略
- ASR、TTS 插件可依 mode 切換 local、remote、server 三種策略
### Test
- 補充 PluginsManager 測試，驗證排序與防呆邏輯
### Docs
- 更新 regulation.md 與 ToDo.md

## [v.0.7.1]
### Change
- 將各插件的 `priority` 移至 `strategies/index.js` 定義
- 插件根目錄改為從 strategies 引入優先度
- 更新 regulation 說明

## [v.0.7.2]
### Change
- 將 `priority` 下放至各策略實作的 `index.js`
- 更新所有插件以從所選策略讀取優先度
- 調整文件說明與 ToDo

## [v.0.7.3]
### Fix
- 補上遠端策略遺漏的 infor.js 檔案
- 修正 LlamaServerManager 策略切換邏輯
### Test
- 新增 ASR、TTS、LlamaServer 遠端策略單元測試

## [v.0.7.4]
### Fix
- 移除多餘的 remote/infor.js，改由 server 策略提供設定
- 修正 TTS 插件策略切換錯誤
### Change
- ASR、TTS 策略 index.js 匯出三種策略
- 整理三個插件根目錄 index.js，統一策略載入邏輯

## [v.0.8]
### New
- 新增 OsInfor 工具，提供 table 與 get 兩種接口
- ASR、TTS、LlamaServer 插件支援自動選擇策略
- 各策略補上 priority 欄位並新增 serverInfo 判定
### Test
- 新增 OsInfor 與 TTS updateStrategy 測試

## [v.0.8.1]
### New
- 更新__test__/old 用來存放舊的測試### pb = plugins branch

## [v.0.9]
### New
- discord 插件（更新記錄詳見 DiscordPlugin.md）

## [v.0.10a]
### Fix
- TalkToDemon 重新整合 historyManager 與 toolOutputRouter，修正合併後遺留的歷史處理問題

# [v.1.0]
### Change
- 將historyManager > getHistory 內的引入參數limit預設改為null，以防止調用全部歷史訊息無門
- 將pluginsManager > loadPlugin 新增一個引入參數'mode'，用來指定插件的運行模式，預設為'auto'
- configLoader 內處理設定檔不存在時，原本會使用console.warn警告，現改為使用logger，以保持所有腳本一致性
- discord 插件內的 guildId 和 channelId 現如今要使用global當作value才能使用全域邏輯
- 修改了 configManager 的 cache清理方式
- 修改了 logger 的壓縮檔案方式，將異步改為同步
### Fix
- 部分測試檔案撰寫時的錯誤

# [v.1.0.1]
### Fix
- 修復log壓縮後不會把原本檔案刪除的問題

# [v.1.1]
### New
- 在PromptComposer中新增工具清單的注入
### Fix
- 修復plugins/toolReference內部的輸出問題，原有腳本會輸出object物件，如今會輸出JSON
- 刪除plugins/toolReference內部有存在不被允許的function定義(getState)
- 修復toolOutputRouter內部的工具呼叫錯誤，原本會將整個tooldata當作input傳入，如今改為tooldata.input
- 修復文案中的說明錯誤
### Change
- 修改toolOutputRouter內部工具執行超時預設值，從1.5秒改成10秒

# [v.1.1.1]
### Fix
- 調整 toolOutputRouter.findToolJSON 僅辨識包含 toolName 與 input 的 JSON，避免誤判
- 當工具呼叫缺少 input 欄位時回傳失敗並記錄警告
### Test

## [v.1.1.2]
### Update
- 對齊 LlamaServer 遠端策略串流事件契約，補上解析失敗與非預期結構的錯誤處理
- 遠端策略支援非串流回應，並維持 data/end 事件形狀一致
# [v.1.1.2]
### Change
- LlamaServer 預設策略改為 Remote，並支援 auto 走遠端
- LlamaServer 遠端設定改為支援 options/env/config 來源，並定義優先序
- 遠端策略新增 model、timeout、req_id 等參數傳遞與錯誤處理
- 更新 toolOutputRouter 相關測試以符合新的 JSON 格式
- 新增測試：當 JSON 包含額外欄位時不應被識別為工具呼叫
- LlamaServer 遠端策略改用 OpenAI 相容 /v1/models 與 /v1/chat/completions 端點，並加入健康檢查與錯誤分類
- 補上 chat/completions 串流與非串流回應正規化，確保事件序列與 local 策略一致
### Fix
- 強化遠端策略錯誤處理與中止流程，避免異常狀態遺留

# [v.1.2]
### New
- 新增 TimeService 這個 llm 工具，供llm使用

# [v.1.2.1]
### Fix
- 修復 TimeService 的描述格式檢查，確保使用 toolName 作為識別欄位
### Delete
- 刪除部分插件中的 toolReference，原因為他們不是llmTool
### Change
- 將模型的n-gpu-layers 由35改為50，確保硬體能滿載運行

# [v.1.2.2]
### Fix
- 將exclusive模式下的模型 由4b改為12b

# [v.1.2.3]
### New
- TalkToDemon 新增status事件，當狀態改變時會觸發，是用來給工具事件判斷使用的
- Discord 的回覆，針對了status的改變進行輸出調整
- logger 的子函數新增safeStringify，用來安全地將物件轉為字串
### Fix
- 修復toolOutputRouter錯誤的工具判斷，修改為更正確且嚴謹的判斷方式
### Change
- TimeService中的工具描述，從中文修改為英文

# [v.1.2.4]
### New
- TimeService新增了時間差值的計算功能
- LLMTool新增了error的使用規範以及功能

# [v.1.2.4.1]
### Fix
- 修復 TimeService 錯誤的工具敘述

# [v.1.2.5]
### Change
- 將 TimeService 改為兩個工具，一個是取得時間，一個是計算時間差

# [v.1.2.6]
### Fix
- 修復調用工具時，工具的Json會被移除，但是markdown外框不會被移除的問題

# [v.1.2.7]
### New
- 新增一鍵上線LLMTool的功能，可以一次啟動被排除工具以外的所有工具

# [v.1.3]
### New
- 新增 WeatherSystem 插件，整合中央氣象署 10 種氣象資料並預設臺南市查詢參數
- 新增 jsonParser 工具，提供 JSON 字串解析與資料清理能力
### Change
- WeatherSystem 改採本地策略並從 tokens/cwa.js 載入授權金鑰，同步加入錯誤處理與速率限制
### Test
- 補齊 WeatherSystem 本地策略單元測試，涵蓋缺少金鑰、速率限制與 JSON 解析等情境

# [v.1.3.1]
### Change
- 將WeatherSystem-local的時間常數抽出，以變數定義使用

# [v.1.3.2]
### Fix
- 修正 TalkToDemon 在工具觸發後的等待狀態管理
- 修復 pluginsManager 載入LLM插件時的錯誤邏輯

# [v.1.3.3]
### Test
- 補齊pluginsManager的全面覆蓋測試

# [v.1.4]
### Change
- 將 toolReference 插件改為 LLMTool 插件，並調整相關邏輯，使工具列表的使用與呈現更完善
# [v.1.5]
### New
- 新增 calendarSystem 插件，整合本地伺服器與 CalDAV 客戶端、同步工作者與快取架構
- 建立 Server/calendar 模組，含 secrets 載入、快取、CalDAV 客戶端與同步排程
### Test
- 補充 calendarSystem 單元測試，驗證 CRUD 流程與插件指令路由
### Docs
- 撰寫 calendarSystem 插件 README，說明指令使用方式與注意事項

# [v.1.5.1]
### Change
- 重構 calendarSystem 插件為策略化架構，所有指令與啟停流程統一透過 local 策略管理
- 重寫 Server/calendar 密鑰載入邏輯，強制使用 CommonJS tokens 並移除預設憑證 fallback
### Docs
- 更新 calendarSystem README 與 tokens/README.md，說明憑證需求與策略限制
### Test
- 調整 calendarSystem 單元測試以注入模擬憑證並驗證新策略行為

# [v.1.5.2]
### Fix
- 移除 calendarSystem 插件與本地策略中的測試掛鉤，確保僅暴露符合規範的介面
### Change
- 強化本地策略的 configure 錯誤處理，並支援透過選項重設伺服器工廠
### Test
- 更新 calendarSystem 單元測試改以啟動選項注入測試伺服器並於測試後還原設定

<!-- 段落說明：紀錄 v1.5.2.1 版本的日誌更新摘要 -->
# [v.1.5.2.1]
<!-- 段落說明：說明此次更新為文件調整事項 -->
### Docs
<!-- 段落說明：描述整併更新紀錄與調整 tool-description 內容的細節 -->
- 將 calendarSystem 工具更新紀錄合併至 MainVersion，並同步校正 tool-description.json 的 actions 與參數說明
- 更新 calendarSystem README，補充工具呼叫時的輸入輸出結構與參數需求
<!-- 段落說明：紀錄 v1.5.2.2 版本的更新摘要 -->
# [v.1.5.2.2]
<!-- 段落說明：此次更新針對文件細節補充 -->
### Docs
<!-- 段落說明：描述 tool-description actionParams 的細節補強 -->
- 細化 calendarSystem tool-description.json 的 actionParams 欄位，逐一列出 payload 與 options 內部欄位與型別需求
<!-- 段落說明：描述 README 補充內容 -->
- 擴充 calendarSystem README，新增欄位對照表與 options 說明，並確認接口相容性敘述

# [V.1.5.2.3]
### Fix
- 修正caldavClient在初始化客戶端時，未將xhr傳入導致無法建立成功的問題
- 修復secrets未將homeURL傳出的問題
- 修復fileEditer的readDir在輸出文件時，隨機排序的問題，現在他會正常排序了
### Docs
- 更新calendar的工具使用描述，將其從中文改為英文
- 修改toolReference的setting，將其從tool改為LLMtool
### Change
- 將toolReference原本會傳出的generatedAt移除，因為會影響到LLM使用工具

<!-- 段落說明：紀錄 v1.5.2.4 版本的更新摘要 -->
# [v.1.5.2.4]
### Change
- 遠端 llamaServer 支援從 options/config/env 注入 timeout 與 req_id，並統一加入請求追蹤 header
- 新增 4xx、5xx、timeout、parse error 的錯誤分類，統一錯誤物件格式供下游辨識
### Fix
- 強化串流解析錯誤與資料超時的錯誤回報，補齊 log/context 追蹤資訊
