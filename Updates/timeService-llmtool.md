#### timeService 插件更新紀錄

### [v0.1]
## New
- 新增 timeService 插件，支援時間偏移與時區計算

### [v0.2]
## Change
- 移除 remote 策略，專注於本地時間計算

### [v0.3]
## Add
- 補上 timeService 單元測試腳本，涵蓋基本計算與錯誤情境

### [v0.4]
## Add
- 加入閏年 2 月 29 日的日期修正與對應測試

### [v0.5]
## Add
- 新增 `baseTime`、`targetTime` 欄位並支援時間差距計算
- 回傳格式加入 `resultType` 欄位
- 補強錯誤碼 `IGNORED_BASE_ONLY` 與相關單元測試

### [v0.6]
## Change
- 拆分為 `getTime` 與 `diffTime` 兩個 llmTool，原模組停止維護
