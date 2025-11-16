# calendarSystem 插件

<!-- 段落說明：交代 calendarSystem 的插件定位 -->
## 模組定位

<!-- 段落說明：說明插件連結本地伺服器與遠端 CalDAV 的角色 -->
calendarSystem 插件負責串接本地行事曆伺服器與 iCloud CalDAV，提供 LLM 端可調用的 CRUD 與同步能力。

<!-- 段落說明：介紹可用指令與關鍵參數 -->
## 指令列表

<!-- 段落說明：彙整每個指令的用途與必要參數 -->
| 指令 | 說明 | 主要參數需求 |
| ---- | ---- | ---- |
| `create` | 建立事件並同步至遠端 | `payload.calendarName`、`payload.summary`、`payload.startISO`、`payload.endISO` |
| `update` | 更新既有事件並同步 | `uid`、`payload` 中需包含欲更新欄位 |
| `delete` | 刪除事件，可選擇軟刪除 | `uid`、`options.soft`（布林，預設 `false`） |
| `read` | 讀取單筆事件 | `uid` |
| `list` | 篩選事件列表 | `options.calendarName`（選填）、`options.rangeStart`（選填）、`options.rangeEnd`（選填）、`options.includeDeleted`（選填） |
| `push` | 觸發同步流程 | `options.type`：`incremental` 或 `full`，預設 `incremental` |
| `status` | 查詢伺服器狀態與最近同步資訊 | 無需額外欄位 |

<!-- 段落說明：提供 action 參數的詳細說明 -->
## 參數細節

<!-- 段落說明：列出 create 指令 payload 的欄位與預設值 -->
### create 指令 payload 欄位

<!-- 段落說明：以表格呈現 create payload 必填與選填項目 -->
| 欄位 | 必填 | 型別 | 說明 |
| ---- | ---- | ---- | ---- |
| `calendarName` | 是 | String | 指定事件寫入的行事曆名稱，會對應到 CalDAV displayName。 |
| `summary` | 是 | String | 事件主旨。 |
| `startISO` | 是 | String | 事件開始時間，需為 ISO 8601 UTC 格式，例如 `2024-01-01T00:00:00.000Z`。 |
| `endISO` | 是 | String | 事件結束時間，需為 ISO 8601 UTC 格式且不得早於 `startISO`。 |
| `description` | 否 | String | 事件描述，未填時預設為空字串。 |
| `location` | 否 | String | 事件地點，未填時預設為空字串。 |
| `attendees` | 否 | Array<Object> | 參與者列表，每筆物件建議提供 `address`、`name` 與 `role` 等 CalDAV 兼容欄位，未填時預設為空陣列。 |
| `reminders` | 否 | Array<Object> | 提醒設定陣列，建議使用 `{ type: 'display', minutesBefore: 30 }` 等結構描述觸發條件，未填時預設為空陣列。 |
| `recurrenceRule` | 否 | String | 重複規則，需遵循 RFC 5545 RRULE 格式，未填時為 `null`。 |
| `metadata` | 否 | Object | 自訂中繼資料，必須為一般物件且不接受陣列。 |
| `etag` | 否 | String | 遠端事件版本識別碼，通常由同步流程自動帶入。 |
| `url` | 否 | String | 遠端事件 CalDAV URL，通常於同步後由伺服器填入。 |

<!-- 段落說明：列出 update 指令 payload 的欄位用途 -->
### update 指令 payload 欄位

<!-- 段落說明：以表格呈現 update payload 支援的欄位 -->
| 欄位 | 必填 | 型別 | 說明 |
| ---- | ---- | ---- | ---- |
| `calendarName` | 否 | String | 更新事件所屬行事曆名稱。 |
| `summary` | 否 | String | 更新後的事件主旨。 |
| `description` | 否 | String | 更新後的事件描述。 |
| `location` | 否 | String | 更新後的事件地點。 |
| `attendees` | 否 | Array<Object> | 完整覆寫的參與者陣列，結構與 create 指令相同。 |
| `reminders` | 否 | Array<Object> | 完整覆寫的提醒陣列，結構與 create 指令相同。 |
| `recurrenceRule` | 否 | String | 新的 RRULE 規則。 |
| `startISO` | 否 | String | 更新後的開始時間（ISO 8601 UTC）。 |
| `endISO` | 否 | String | 更新後的結束時間（ISO 8601 UTC）。 |
| `metadata` | 否 | Object | 覆寫事件的自訂中繼資料。 |
| `lastModified` | 否 | String | 客製的最後修改時間（ISO 8601），省略時伺服器會以當前時間覆蓋。 |
| `status` | 否 | String | 事件狀態標記，例如 `updated`、`synced`、`deleted`。 |
| `etag` | 否 | String | 覆寫快取中的遠端版本識別碼。 |
| `url` | 否 | String | 覆寫快取中的 CalDAV URL。 |

<!-- 段落說明：列出 options 型態的欄位使用方式 -->
### options 欄位使用方式

<!-- 段落說明：描述 delete、list、push 需要的 options -->
- `delete.options.soft`：布林，預設 `false`，設為 `true` 時只在本地標記刪除。
- `list.options.calendarName`：String，指定行事曆名稱。
- `list.options.rangeStart` / `rangeEnd`：String，ISO 8601 UTC 時間範圍，用於篩選事件。
- `list.options.includeDeleted`：Boolean，預設 `false`，設為 `true` 時包含已刪除事件。
- `push.options.type`：String，`incremental`（預設）或 `full`，決定同步模式。

<!-- 段落說明：補充 tool-description 內的輸入輸出結構，方便串接 -->
## 工具描述與參數結構

<!-- 段落說明：說明呼叫工具時應使用的 JSON 結構 -->
- 呼叫格式需遵守 `tool-description.json` 的規範，最外層以 `action` 指定要執行的指令，並於 `params` 內放入對應欄位。
- `params` 在送入伺服器前會被插件展開為 `payload`、`uid`、`options` 等欄位，欄位名稱與伺服器方法一一對應。
- `payload` 物件需符合上方欄位規格，缺少必要欄位（如 `calendarName`、`summary`、`startISO`、`endISO`）會導致伺服器回傳錯誤。
- `options` 物件僅接受 `soft`、`calendarName`、`rangeStart`、`rangeEnd`、`includeDeleted`、`type` 等欄位，多餘欄位會被忽略。
- 工具回傳物件遵循 `success`、`result`、`resultType`、`error`、`value` 欄位結構，讓上層任務能判斷是否需要重試或紀錄錯誤。

<!-- 段落說明：說明介面相容性與伺服器端需求 -->
## 介面相容性說明

<!-- 段落說明：確認 JSON 結構與伺服器實際需求的對應關係 -->
更新後的 `tool-description.json` 與本地策略 `send` 方法所需欄位完全相符，`payload`、`uid`、`options` 會在傳遞至伺服器前被原樣展開，使 `createEvent`、`updateEvent`、`deleteEvent`、`listEvents`、`triggerSync` 與 `getStatus` 等方法能精準取得必要參數。

<!-- 段落說明：提醒整體使用上的注意事項 -->
## 注意事項

<!-- 段落說明：條列操作日常需注意的事項 -->
1. 伺服器啟動後會自動進行分鐘級同步與每日全量同步。
2. 若缺少 `tokens/icloud.js`，插件會直接拒絕啟動以避免使用預設憑證洩漏。
3. 所有時間均以 UTC ISO 8601 儲存，顯示時再行轉換。
4. 目前僅提供本地 `local` 策略，所有指令皆透過本地伺服器執行。
