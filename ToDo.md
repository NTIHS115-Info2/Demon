# Demon Plugin 系統 v1.5 - ToDo 清單

## ✅ 高優先事項

- [ ] 完成 toolOutputRouter 實作
  - [ ] 判斷工具輸出格式是否合法（JSON 結構、欄位完整）
  - [ ] 成功回傳時注入狀態給 PromptComposer
  - [ ] 錯誤與逾時時也注入對應失敗狀態

- [ ] 完成 PromptComposer 工具狀態注入邏輯
  - [ ] 接收工具執行狀態（成功、逾時、失敗）
  - [ ] 建構對應的 system prompt 提示字串格式
  - [ ] 測試注入後 LLM 能否辨識並正確回應

- [ ] 撰寫一組測試用 MockPlugin
  - [ ] 提供簡單功能（如：字串轉大寫）
  - [ ] 提供 tool-description.json
  - [ ] 可人工模擬成功、失敗、逾時情境

## 🔧 中優先事項

- [ ] 撰寫 `tool-description.json` 標準格式範本
  - [ ] 含基本說明、輸入範例、回傳格式範例

- [ ] 建立 ToolReferencePlugin
  - [ ] 自動讀取所有插件的 tool-description.json
  - [ ] 整理為可給 LLM 查詢用的工具說明清單

## 🧪 測試項目

- [ ] 工具正常流程：LLM 呼叫 → 插件成功回傳 → 正確注入 → LLM 正確回應
- [ ] 工具逾時流程：超過等待時間 → 注入失敗狀態 → LLM 給出容錯回應
- [ ] 工具錯誤格式：回傳非 JSON → router 忽略 → 原樣輸出（fallback）

## 📌 補充任務

- [ ] 製作 toolOutputRouter + PromptComposer 串接流程圖（可用 mermaid）