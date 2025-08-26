# diffTime 插件

計算兩個時間點差距的 LLM 工具，僅需提供基準與目標時間。

## 使用方式
- 啟動插件後透過 `send` 傳入 JSON 參數。
- 支援欄位：
  - `baseTime`：字串，可選，格式 `YYYY-MM-DD hh:mm:ss`，未提供則使用現在時間（UTC+8）。
  - `targetTime`：字串，必填，格式 `YYYY-MM-DD hh:mm:ss`，欲比較的目標時間。
- 若僅提供 `baseTime` 將回傳錯誤。
- 輸出格式：
  - **成功**：`{"result": "YY-MM-DD hh:mm:ss", "resultType": "time"}`
  - **失敗**：`{"error": "錯誤原因"}`

## 策略
- **local**：使用系統時間進行計算，目前僅提供此模式。
