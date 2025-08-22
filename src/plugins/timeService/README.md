# timeService 插件

提供時間偏移與時區計算功能的 LLM 工具，並內建處理閏年 2 月 29 日。

## 使用方式
- 啟動插件後，透過 `send` 傳入 JSON 參數。
- 參數包含 `timezone`、`Y`、`M`、`D`、`h`、`m`、`s`，皆為整數。
- 回傳格式為 `{ "result": "YYYY-MM-DD hh:mm:ss (UTC+X)" }`。

## 策略
- **local**：使用系統時間進行計算，目前僅提供此模式。
