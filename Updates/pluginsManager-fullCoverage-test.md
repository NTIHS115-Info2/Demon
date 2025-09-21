# pluginsManager 全插件規範測試 更新紀錄

- 新增 `__test__/pluginsManager.fullCoverage.test.js`，以 PluginsManager 掃描並載入所有插件，逐項檢查必要接口、LLM 工具描述與註冊狀態。
- 模擬 logger 與 axios，避免測試觸發實體 I/O 或網路操作，並透過錯誤處理提供更明確的失敗訊息。
- 將 `toolReference` 插件的定位從 LLM 工具調整為一般 Tool，並更新完整覆蓋測試以驗證分類邏輯，避免誤登錄至 LLM 插件索引。
- 移除 `toolReference/tool-description.json`，維持工具型插件的檔案結構簡潔，避免與 LLM 規範混淆。
