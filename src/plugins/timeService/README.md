# timeService 插件

提供時間偏移、時區轉換與時間差距計算功能的 LLM 工具，並內建處理閏年 2 月 29 日。

## 使用方式
- 啟動插件後，透過 `send` 傳入 JSON 參數。
- 支援欄位：
  - `timezone`：整數，可選，預設 8，表示目標時區（相對 UTC）。
  - `Y`、`M`、`D`、`h`、`m`、`s`：整數偏移量，可為正或負。
  - `baseTime`：字串，可選，格式 `YYYY-MM-DD hh:mm:ss`，作為基準時間點。
  - `targetTime`：字串，可選，格式 `YYYY-MM-DD hh:mm:ss`，欲與基準比較的目標時間。
- 若僅提供 `baseTime` 而無 `targetTime`，將回傳錯誤碼 `IGNORED_BASE_ONLY`。
- 輸出格式：
  - **成功**：`{"success": true, "result": "YYYY-MM-DD hh:mm:ss", "resultType": "time"}`
  - **失敗**：`{"success": false, "error": "錯誤原因", "value": {}}`

## 策略
- **local**：使用系統時間進行計算，目前僅提供此模式。
