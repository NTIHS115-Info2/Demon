# calendarSystem 插件

## 模組定位

calendarSystem 插件負責串接本地行事曆伺服器與 iCloud CalDAV，提供 LLM 端可調用的 CRUD 與同步能力。

## 指令列表

| 指令 | 說明 | 參數 |
| ---- | ---- | ---- |
| `create` | 建立事件並同步至遠端 | `payload`：事件資料 |
| `update` | 更新事件並同步 | `uid`、`payload` |
| `delete` | 刪除事件 | `uid`、`options.soft` |
| `read` | 讀取單筆事件 | `uid` |
| `list` | 篩選事件 | `options`：篩選條件 |
| `push` | 觸發同步 | `options.type`：`incremental` / `full` |
| `status` | 查詢伺服器狀態 | 無 |

## 注意事項

1. 伺服器啟動後會自動進行分鐘級同步與每日全量同步。
2. 若缺少 tokens/icloud.js，插件會直接拒絕啟動以避免使用預設憑證洩漏。
3. 所有時間均以 UTC ISO8601 儲存，顯示時再行轉換。
4. 目前僅提供本地 `local` 策略，所有指令皆透過本地伺服器執行。
