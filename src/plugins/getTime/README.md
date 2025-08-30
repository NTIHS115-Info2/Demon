# getTime 插件

取得當前時間並套用偏移的 LLM 工具，不提供自訂基準時間。

## 使用方式
- 啟動插件後透過 `send` 傳入 JSON 參數。
- 支援欄位：
  - `timezone`：整數，可選，預設 8，表示目標時區。
  - `Y`、`M`、`D`、`h`、`m`、`s`：整數偏移量，可為正或負。
- 不支援 `baseTime` 與 `targetTime` 參數。
- 輸出格式：
  - **成功**：`{"result": "YYYY-MM-DD hh:mm:ss (UTC+X)", "resultType": "time"}`
  - **失敗**：`{"error": "錯誤原因"}`

## 策略
- **local**：使用系統時間進行計算，目前僅提供此模式。
