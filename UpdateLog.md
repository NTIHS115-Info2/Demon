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