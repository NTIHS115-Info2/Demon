### [v.0.1.0]
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

### [v.0.2.0]
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

### [v.0.3.0]
## New
- 新的工具規範與架構
- 重新撰寫內部文件編輯器，以便適應新的工具規範
## Delete
- 刪除了舊的內部文件編輯系統以及測試檔案

### [v.0.3.1]
## Fix
- Bug修復

### [v.0.4.0]
## New
- 將logger轉移到utils下，更符合其定位
- llama的ServerManager細部實作改為async
- 建立plugins的插件架構規範
- 建立TalkToDemon
- 建立PluginsManager
- 引入jest測試方式
- 將所有測試改為jest