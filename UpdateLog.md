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
- 新增計算機工具(計算基本、進階與高等數學功能)
- 增加 HTTP 介面以接受運算請求
## Fix
- 修正 UpdateLog 檔案結尾異常字串

### [v.0.3.1]
## Change
- 移除計算機 HTTP 介面
- 新增自然語言解析模組，提供 evaluateNaturalLanguage 函式
- 更新 CalculatorTest.js 測試自然語言運算

### [v.0.4.0]
## New
- 擴充自然語言解析器，支援更多中英文運算敘述
- 新增 formatter 模組，可將運算式轉為通用符號表示
- calculator 模組增加 naturalLanguageToSymbol 與 formatExpression 函式
- 測試腳本記錄運算結果與符號表示
