## 📦 Project Overview

* **Name**: `pluginsManager-Function-Expansion`
* **Purpose**:
  新增兩個接口 **StartLLMTool** 與 **SetExceptionLLMTool**。
  `StartLLMTool` 用來啟動除例外清單外的所有 LLM 插件，
  `SetExceptionLLMTool` 用來設定例外清單，避免指定插件被啟動。

## 🛠 Tools & Permissions

* **Available tools**:

  * `logger`: 用於紀錄與除錯訊息
  * `plugins_manager_core`: 存取 pluginsManager 內部子函數以擴充功能
* **Access scope**: **Limited write**

## 🔄 Planning / Scheduling

* **Dependencies**: `none`

## 🎯 Success Criteria

* 能正確透過 `SetExceptionLLMTool` 設定例外插件清單
* `StartLLMTool` 啟動所有非例外 LLM 插件且回傳狀態正確

## ⚠️ Limits & Safeguards

* 僅能修改和新增與 `StartLLMTool`、`SetExceptionLLMTool` 相關程式碼，不得影響 pluginsManager 其他核心邏輯
* 測試腳本與 UpdateLog 可新增或修改，其餘檔案保持唯讀
* logger 必須完整紀錄啟動過程與例外設定，確保可追蹤

## 🧪 Testing Instructions

* 在專案根目錄執行：`pnpm --filter pluginsManager-Function-Expansion test`，以 **Jest** 跑整體測試，需同時驗證 `StartLLMTool` 與 `SetExceptionLLMTool` 可用
* 新增整合測試 `__tests__/llmTool.integration.test.ts`：

  * 先呼叫 `SetExceptionLLMTool` 設定例外清單，再呼叫 `StartLLMTool`，確認只啟動非例外插件（以插件狀態或 mock 斷言驗證）
  * 驗證呼叫順序、回傳值與 logger 有正確紀錄（使用 mock logger 斷言被呼叫次數與參數）
* 本地快速跑單一測試檔：`pnpm --filter pluginsManager-Function-Expansion jest __tests__/llmTool.integration.test.ts --runInBand`

## 🧑‍💻 Dev Tips

* 介面命名遵循現有 pluginsManager 風格，與既有方法一致（大小寫、動詞時態）
* 對 `this.getAllLLMPlugin()` 的回傳結果做型別守衛（確認為 `Array<object>` 且含必要欄位）
* 新增的公開表面最小化：僅暴露 `StartLLMTool`、`SetExceptionLLMTool` 與必要型別
* logger 與 UpdateLog 職責分離：即時運行記錄走 logger，版本變更記錄寫入 UpdateLog
* 測試以整合情境為主（Jest），mock plugins 與 logger，避免依賴真實外部狀態
* 嚴格避免副作用：不更動其他核心邏輯與設定，必要改動集中在本次新增接口

---

# 📝 PR Example

* **PR Title**: `[pluginsManager-Function-Expansion] Add StartLLMTool & SetExceptionLLMTool interfaces`
* **PR Description**:

  ```
  - Project purpose: 新增 StartLLMTool 與 SetExceptionLLMTool 兩個接口，擴充 pluginsManager 功能
  - Tools/Permissions: 使用 logger 與 plugins_manager_core；權限為 Limited write
  - Success Criteria: 能設定例外清單並啟動所有非例外 LLM 插件，狀態回傳正確
  - Limits/Safeguards: 僅允許修改和新增本次相關程式碼、UpdateLog 與測試腳本，其餘維持唯讀
  ```

---
