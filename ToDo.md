# Demon Plugin 系統 v1.5 - ToDo 清單

## ✅ 高優先事項

- [x] 完成 toolOutputRouter 實作
  - [x] 判斷工具輸出格式是否合法（JSON 結構、欄位完整）
  - [x] 成功回傳時注入狀態給 PromptComposer
  - [x] 錯誤與逾時時也注入對應失敗狀態

- [x] 完成 PromptComposer 工具狀態注入邏輯
  - [x] 接收工具執行狀態（成功、逾時、失敗）
  - [x] 建構對應的 system prompt 提示字串格式
  - [x] 測試注入後 LLM 能否辨識並正確回應

- [x] 撰寫一組測試用 MockPlugin
  - [x] 提供簡單功能（如：字串轉大寫）
  - [x] 提供 tool-description.json
  - [x] 可人工模擬成功、失敗、逾時情境

## 🔧 中優先事項

- [x] 撰寫 `tool-description.json` 標準格式範本
  - [x] 含基本說明、輸入範例、回傳格式範例

- [x] 建立 ToolReferencePlugin
  - [x] 自動讀取所有插件的 tool-description.json
  - [x] 整理為可給 LLM 查詢用的工具說明清單

## 🧪 測試項目

- [x] 工具正常流程：LLM 呼叫 → 插件成功回傳 → 正確注入 → LLM 正確回應
- [x] 工具逾時流程：超過等待時間 → 注入失敗狀態 → LLM 給出容錯回應
- [x] 工具錯誤格式：回傳非 JSON → router 忽略 → 原樣輸出（fallback）

## 📌 補充任務

- [x] 製作 toolOutputRouter + PromptComposer 串接流程圖（可用 mermaid）
