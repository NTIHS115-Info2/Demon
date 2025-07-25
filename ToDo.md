## ToDo：對話歷史注入模組

- [x] 實作 `core/historyManager.js` 模組
  - 儲存所有使用者與 agent 對話歷史（時間排序、角色分類）
  - 提供 `appendMessage(userId, role, content)` API
  - 提供 `getHistory(userId, limit)` API 供系統 prompt 注入使用

- [x] 整合 `historyManager` 至 pluginsManager 主控流程
  - 每次新回應都自動記錄
  - 提供注入對話記憶到 system prompt 的功能

- [x] 設計歷史訊息裁剪與清理策略
  - 可限制記憶長度（token 上限）
  - 保留近期、高權重對話

- [x] 撰寫單元測試驗證儲存與注入功能
