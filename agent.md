## Demon 工具系統整合目標

### 🎯 目標概要

本次重構的核心目標是：讓 Demon 模型具備「執行力」，能夠在對話過程中調用各種外部工具來完成任務，例如資料查詢、日程管理等。  
此版本專注於**工具使用的架構建立**與**核心模組重構**。

---

### 🧩 系統模組任務分工

#### 🔧 TalkToDemon
- 新增「忙碌中」狀態：
  - 當等待工具回傳時，模型進入 `busy` 狀態
  - 回覆預設字串：「我正在查詢，請稍等我一下～」

#### 🔧 pluginManage
- 新增函數 `getLLMPlugin(name)`：取得指定 LLM 插件
- 新增函數 `getAllLLMPlugin()`：取得所有註冊的 LLM 插件清單
- 提供各插件支援工具與 metadata 的查詢功能

#### 🔧 PromptComposer
- 功能目標：將工具的使用狀態注入給 LLM 作為 system prompt 參考依據
- 不負責工具邏輯處理，也不參與結果判斷與輸出路由
- 僅負責建構以下資訊格式，並注入提示詞中：
  - 工具是否已呼叫
  - 是否有結果回傳
  - 回傳內容是否為錯誤（可選）

#### 🔧 ToolReferencePlugin（工具書插件）
- 功能：列出目前系統所有可用工具及其說明
- 輸出格式為自然語言摘要，並依用途分類（如查詢類、管理類、補全類）

#### 🔧 toolOutputRouter.js（放於 `root/src/core`）
- 執行位置：`talkToDemon.js` 回覆使用者之前
- 功能流程：
  - 截取 LLM 輸出中的工具資訊（預期為 JSON）
  - 若成功解析，依 `toolResultTarget` 分流輸出
  - 若格式不符，視為一般回覆輸出
  - 失敗或逾時時，插入錯誤提示並交由 LLM 處理

---

### 🧪 補充任務與測試項目

#### 📄 toolOutputRouter 格式規範文件
- 定義何為「合法工具輸出」（如需含欄位：`toolName`, `result`, `toolResultTarget`）
- 錯誤處理包含：格式錯誤、工具不存在、欄位缺失等

#### 📐 工具輸出資料格式範本（Tool Output Schema）
- 建議欄位：
  - `toolName`: 工具名稱
  - `result`: 工具執行結果
  - `errorCode`: 選填，錯誤編號或描述

#### 🧪 MockPlugin 系統測試插件
- 建立範例工具（如：天氣查詢）
- 驗證流程：pluginManage → PromptComposer → toolOutputRouter → talkToDemon 輸出

---
