# calendarSystem 插件

## 模組定位

calendarSystem 插件負責串接本地行事曆伺服器與 iCloud CalDAV，提供 LLM 端可調用的 CRUD、事件列表與同步能力，並統一回傳 `success` / `result` / `resultType` 結構。

## 指令列表

| 指令 | 說明 | 主要參數 | 備註 |
| ---- | ---- | ---- | ---- |
| `createEvent` / `create` | 建立 iCloud 事件並回傳完整紀錄 | `title`、`startTime`、`endTime`、`calendarName?`、`location?`、`description?` | `createEvent` 會回傳 `success/result` 結構；`create` 保留舊版直接回傳伺服器結果 |
| `update` | 依 UID 局部更新事件 | `uid`、`title?`、`description?`、`location?`、`startTime?`、`endTime?`、`calendarName?` | 至少提供一項變更欄位 |
| `delete` | 刪除事件 | `uid`、`soft?` | `soft=true` 僅移除本地快取，不觸發遠端刪除 |
| `read` | 讀取單一事件 | `uid` | 回傳對應事件紀錄 |
| `listEvents` / `list` | 依日期或區間列出事件 | `date` 或 `from`/`to`、`calendarName?`、`includeDeleted?`、`rangeStart?`、`rangeEnd?` | `listEvents` 回傳 `success/result`；`list` 維持直接回傳事件陣列 |
| `push` | 觸發同步工作 | `type?` (`incremental`/`full`) | 預設增量同步 |
| `status` | 查詢伺服器狀態 | 無 | 回傳啟動狀態與快取摘要 |

## 使用注意事項

1. 請以 `action` 搭配 `params` 傳入指令；舊版的 `uid`、`payload`、`options` 仍可使用，但會自動轉換為新格式。
2. `createEvent` 與 `listEvents` 會以 `success` / `result` / `resultType` 包裝結果與錯誤；相容指令 (`create`、`update`、`delete`、`read`、`list`、`push`、`status`) 則維持舊版行為，在成功時直接回傳伺服器資料、失敗時拋出例外。
3. 所有時間欄位需為 UTC ISO8601 字串；若提供日期，會自動換算當日 00:00:00 至 23:59:59 區間，亦可直接傳入 `rangeStart` / `rangeEnd`。
4. 若缺少 `tokens/icloud.js`，插件會直接拒絕啟動以避免使用預設憑證洩漏。
5. 伺服器啟動後會自動進行分鐘級同步與每日全量同步，可透過 `push` 指令強制觸發。
6. `createEvent` / `listEvents` 若失敗會回傳 `success=false` 與 `error` 訊息；舊指令失敗時請改以 `try/catch` 捕捉例外以取得錯誤細節。
7. 目前僅提供本地 `local` 策略，所有指令皆透過本地伺服器執行。
