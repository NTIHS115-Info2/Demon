# 🗓️ Calendar Sync System — Developer Note (Integrated)

> **Repo / Project Name:** `calendar-system`

---

## 📦 Project Overview

**Purpose — 目標**

建立能與 **iCloud / iOS Calendar 雙向同步** 的完整日曆插件系統。系統透過 **Local Calendar Server** 作為中介層，負責：

* CalDAV 同步（增量／全量）
* 事件快取（cache）與版本控制（versioning）
* 對外提供 Plugin API（CRUD + push）

插件端在本地完成事件 **Create / Read / Update / Delete / Push**，由 Local Calendar Server 將變更同步至 **iCloud CalDAV** 伺服器。

---

## 🛠 Tools & Permissions

**Access scope: Full access**

* 涵蓋 **`/plugins/calendar`** 與 **`/server`** 模組
* 需外部網路權限以連線至 **iCloud CalDAV 伺服器**
* 遵循 plugins 撰寫規範（目錄結構、初始化、錯誤處理、型別定義、測試）

---

## 🔄 Planning / Scheduling

**Dependencies**

* **iCloud CalDAV Server**（`https://caldav.icloud.com`）
* **Local Calendar Server**（作為插件與 iCloud 間的中介層）
* **Libraries**：`dav`（CalDAV client）、`ical-generator`（.ics 產生／解析）、`luxon`（時區／時間處理）、`uuid`（UID 生成）、`zod`（事件輸入驗證，選配）

**Schedulers**

* **分鐘級增量同步**：每分鐘執行，僅針對「未來 1 年」視窗
* **每日全量同步**：每日 00:00 全量對帳與清理

---

## 🎯 Success Criteria（成功準則）

**功能面**

1. 本地伺服器能正確快取事件，並維護版本資訊（ETag / URL / lastModified / status / lock）。
2. Plugin API（`create/read/update/delete/push`）可穩定運作，錯誤導向清楚。
3. iCloud CalDAV 雙向同步成功，分鐘級（近端視窗）與每日全量（對帳）皆正確。
4. 鎖定（`locked`）與衝突（conflict）處理規則正確生效。

**效能面**

* 本地 API 回應時間 **< 500ms**（P95）
* 同步結果 **5–15 秒** 內可於 iOS Calendar 觀察到（依網路與 Apple 延遲）

**可靠性／安全性**

* 401/403/429/503 具備 **指數退避** 與重試策略
* 409（sync-token 失效）可自動觸發 **全量同步** 回補
* 所有通訊 **HTTPS**；敏感憑證分離保管

---

## ⚠️ Limits & Safeguards（限制與保護）

* **僅操作「擁有者」的日曆**：被他人分享給你的行事曆不可修改（只能讀取同步）；你分享出去的行事曆可同步。
* **時間儲存一律 UTC / ISO8601**；對外顯示再由 `luxon` 做時區轉換。
* **錯誤碼處理**：

  * **401/403/429/503**：實作重試與 **exponential backoff**（含最大退避與抖動 jitter）
  * **409**（sync-token 失效）：自動觸發 **全量同步**（分段拉取）
* **同步失敗**：保持 `locked` 狀態，避免本地覆寫雲端新版本
* **強制 HTTPS** 通訊；Apple App 專用密碼（App‑Specific Password）
* **遵循 plugins 撰寫規範**（初始化、生命週期、錯誤、日誌、測試）

> 註：不強制撰寫「.ics 單檔大小上限 256 KB」規則。

---

## ⚙️ System Architecture（系統架構）

```
[ Plugin Layer ]  →  [ Local Calendar Server ]  ↔  [ iCloud CalDAV Server ]
    │                      │                           │
    │  create/read/        │                           │  CalDAV: REPORT/PUT/DELETE
    │  update/delete/push  │                           │
    └────── HTTP / IPC ────┘<─────── cron / timers ─────┘
```

### Components

| 模組                        | 職責與說明                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------- |
| **Plugin API Layer**      | 提供 `create/read/update/delete/push`；以 `zod` 驗證輸入；回傳預覽與執行結果。                           |
| **Local Calendar Server** | 管理本地快取 DB（事件、索引、版本資訊）；提供 REST/IPC；維護 `ETag/URL/LAST-MODIFIED` 與 `status/locked`；處理衝突。 |
| **Sync Worker**           | 分鐘級增量（未來 1 年）與每日 00:00 全量對帳／清理；支援 backoff、分段拉取、錯誤重試。                                  |
| **CalDAV Client (`dav`)** | 與 iCloud 通訊：`REPORT`（查詢）、`PUT`（上傳）、`DELETE`（刪除）。                                      |
| **Scheduler**             | 以 `cron` 或 `setInterval` 觸發 minutely 與 daily 任務。                                      |

---

## 📂 Data Model（資料模型）

**事件核心欄位**

| 欄位                        | 型別        | 說明                                                                  |
| ------------------------- | --------- | ------------------------------------------------------------------- |
| `uid`                     | string    | 事件唯一識別；可由插件傳入，否則由伺服器使用 `uuid` 產生。                                   |
| `calendarName`            | string    | 對應 iCloud 行事曆名稱。                                                    |
| `summary`                 | string    | 標題。                                                                 |
| `description`             | string?   | 描述。                                                                 |
| `startISO` / `endISO`     | string    | ISO 8601；**UTC** 儲存。                                                |
| `location`                | string?   | 地點。                                                                 |
| `rrule`                   | string?   | 重複規則（RFC 5545）。                                                     |
| `attendees`               | string[]? | 參與者 email（可擴充為物件）。                                                  |
| `lastModifiedISO`         | string    | 本地最後修改（UTC）。                                                        |
| `remoteETag`              | string?   | iCloud ETag。                                                        |
| `remoteURL`               | string?   | iCloud Object URL。                                                  |
| `status`                  | enum      | `staged` / `pending` / `syncing` / `synced` / `deleted` / `failed`。 |
| `locked`                  | boolean   | 本輪同步是否跳過（編輯中）。                                                      |
| `createdAt` / `updatedAt` | datetime  | 本地建立／更新時間。                                                          |

> 另建 **SyncState** 表：保存 `syncToken`、最近同步結果、錯誤碼與退避指數等資訊。

---

## 🧠 Plugin API（介面）

### 1) `POST /api/calendar/create`

* **描述**：建立事件並回傳建立結果、`uid`、預覽內容
* **狀態**：新建預設 `status=staged`（可離線反覆編輯，尚未上雲）
* **回應**（範例）

```json
{
  "ok": true,
  "uid": "abc123@system",
  "preview": {
    "title": "專題會議",
    "when": "2025-10-20 10:00–11:00 (+08)",
    "note": "討論進度與目標"
  }
}
```

### 2) `GET /api/calendar/read`

* **查詢方式**：`uid` / 時間區間（預設「未來 1 年」）/ 關鍵字（本地索引）

### 3) `PATCH /api/calendar/update/:uid`

* **描述**：更新事件；刷新 `lastModifiedISO`；狀態維持 `staged`（未 push 前不會上雲）

### 4) `DELETE /api/calendar/delete/:uid`

* **描述**：標記刪除（`status=deleted`），由同步流程實際 `DELETE`

### 5) `POST /api/calendar/push`

* **描述**：立即同步指定或全部待處理項目（`staged/pending/deleted`；排除 `locked=true`）
* **回應**（範例）

```json
{ "ok": true, "pushed": ["abc123@system", "def456@system"] }
```

---

## 🔁 Synchronization Logic（同步邏輯）

### A. 分鐘級增量（近端視窗）

* **範圍**：現在 → +1 年
* **週期**：每分鐘一次
* **步驟**：

  1. `REPORT`（含 `<time-range>`）拉取 iCloud 未來 1 年事件
  2. 以 `UID` 合併：

     * 本地不存在 → 新增本地快取
     * 本地存在 → 比對 `LAST-MODIFIED`（新者勝），必要時比較 `ETag`
  3. 上傳本地 `pending/staged/deleted`（排除 `locked=true`）
  4. 更新 `ETag/URL/lastModifiedISO`；記錄結果
  5. 錯誤處理：429/503 → backoff；409 → fallback 全量（分段）

### B. 每日全量對帳（00:00）

* 優先使用 `sync-token`；若 **409** → 重置 token，改用 **分段全量拉取**（例如逐月）
* 雙邊對帳：補漏／更新／清理孤兒；索引整理

### C. 衝突解決矩陣

| 條件                            | 決策            |
| ----------------------------- | ------------- |
| `LAST-MODIFIED` 不同            | 取較新版本         |
| `LAST-MODIFIED` 相同但 `ETag` 不同 | 以 iCloud 版本為準 |
| 兩邊皆剛更新                        | 以時間較晚者為主      |
| 本地編輯中（`locked=true`）          | 當輪略過；下輪再處理    |

### D. Lock 行為

| 狀態            | 行為                   |
| ------------- | -------------------- |
| `locked=true` | 當輪忽略同步（避免邊改邊傳）       |
| 同步成功          | 自動解除 lock            |
| 同步失敗          | 保持 lock，等待下輪重試（避免覆寫） |

---

## 🧪 Testing Instructions（測試）

### 本地測試

* **分鐘級同步測試**：確認未來一年內的事件能在本地與 iCloud 間雙向更新。
* **每日全量同步測試**：確認凌晨全量比對能正確補遺漏事件、清理孤兒事件、同步刪除標記。

### 整合 / CI 測試

* **CalDAV 登入成功**：驗證憑證與連線設定。
* **CRUD API 正確性**：建立、查詢、更新、刪除、推送事件皆正常，含錯誤回應測試。
* **Locked 機制**：當事件 `locked=true` 時，本輪同步跳過；成功同步後解除。
* **雙向同步一致性**：本地與 iCloud 的結果完全一致（事件數量、內容、ETag）。
* **快取比對**：本地快取的 `ETag/URL` 與 iCloud 保持一致。
* **錯誤回復測試**：401/403/429/503 能正確退避重試；409 能觸發全量回補。
* **效能驗證**：本地 API 回應時間 < 500ms；事件變更後 5–15 秒內可於 iOS Calendar 觀察到。

---

## 🧩 Network & Security（網路與安全）

* Endpoint：`https://caldav.icloud.com`（**HTTPS only**）
* 認證：Apple **App‑Specific Password**
* 憑證管理：使用環境變數與秘密管理（.env、Vault、CI Secret），**禁止**入庫
* 錯誤碼處理：

  * **401** 認證失敗 → 通知並暫停同步，要求更新密碼
  * **403** 權限受限 / 被限制 → 延遲 5 分鐘再試
  * **429** Rate limit → 指數退避 + 抖動
  * **503** 伺服器忙碌 → 指數退避 + 抖動
  * **409** `sync-token` 失效 → 重置 token，啟動分段全量

**Backoff 建議（Pseudo）**

```
base = 1000ms
attempt = n (1..Nmax)
max = 60_000ms
jitter = random(0, base)
delay = min(max, (2 ** (attempt-1)) * base + jitter)
```

---

## 🕐 Scheduling（排程）

**cron 建議**

```cron
* * * * * node worker/minutely.js
0 0 * * * node worker/daily.js
```

**環境變數**

```bash
ICLOUD_USER=your-apple-id@email.com
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
ICLOUD_CAL_NAME=小惡魔行事曆
TIMEZONE=Asia/Taipei
SYNC_INTERVAL_MINUTES=1
```

---

## 📈 Observability（可觀測性）

* **Logging**：請求／回應（隱藏敏感欄位）、錯誤碼、延遲、退避次數、同步摘要（新增／更新／刪除計數）
* **Metrics**：API P50/P95、同步耗時、同步窗口大小、成功率、退避分佈、對帳差異數
* **Tracing**：為 `create→push→PUT` 與 `REPORT→merge→update` 建立 trace span

---

## ✅ Developer Checklist（開發核對表）

* [ ] 能列出 iCloud 行事曆並完成 CalDAV 登入
* [ ] `create/read/update/delete/push` 介面通過測試
* [ ] 分鐘級同步 **僅影響未來 1 年**
* [ ] 每日 00:00 全量對帳與清理
* [ ] 衝突判定以 **最新時間** 為準；`ETag` 異常時以 iCloud 為主
* [ ] `locked` 項目可正確略過與恢復
* [ ] Backoff / Retry 策略生效
* [ ] 本地 API P95 < 500ms
* [ ] iOS Calendar 可在 5–15 秒內看到結果
* [ ] 全面 HTTPS；密鑰分離保管

---

## 📘 Notes & Constraints（附註）

* iCloud 不因查詢次數或同步頻率收費；但需遵守 rate limit。
* 不支援全文模糊搜尋；先在本地索引與過濾。
* 僅操作擁有者日曆；**無法編輯「被分享」給你的日曆**。

---

## 🧭 Dev Tips（設計建議）

* 架構分層：**Plugin Layer → Local Calendar Server ↔ iCloud CalDAV Server**；以本地伺服器作為快取與版本控制中介。
* Local Calendar Server：提供事件 CRUD 與 Push API、維護 `ETag/URL/lastModified`、處理衝突與 `lock`。
* Sync Worker：分鐘級（未來 1 年）增量同步；每日 00:00 全量對帳與清理；支援 backoff 與 **409** 失效回補。
* CalDAV（`dav`）：使用 `REPORT/PUT/DELETE`；優先用 `LAST-MODIFIED` 與 `ETag` 比對。
* Scheduler：以 cron/timer 觸發 `minutely-nearby-sync` 及 `daily-full-resync`。
* 輸入驗證：建議 `zod` 驗證 Plugin API 的事件結構；所有函式使用 `async`。
* 錯誤處理：401/403/429/503 指數退避；409 觸發 `sync-token` 重置與**分段全量拉取**。
* 時間處理：一律 UTC / ISO8601；對外顯示用 `luxon` 轉換時區。
* 安規：強制 HTTPS，憑證與 Apple App 專用密碼分離保管。

---

## 🔭 Future Extension（後續擴充）

* RRULE / VALARM / ATTENDEE 進階支援（含邀請狀態）
* WebSocket / Server‑Sent Events：即時同步完成通知
* 多供應商抽象層：統一 Google / iCloud / Exchange 的 Calendar Adapter
* 版本快照／Undo（event history）

---

## 🔑 Tokens-based Configuration (JS modules)

> 依你的要求：**改用 `tokens/*.js` 以匯入方式取得機密**，不再使用 `.env`。

**檔案結構建議**

```
project-root/
  tokens/
    icloud.js           # 憑證與設定（不要入庫）
    README.md           # 放置生成方式與風險說明
  server/
    config/
      secrets.js        # 對外統一出口（集中載入 tokens）
```

**tokens/icloud.js**

```js
// tokens/icloud.js
const ICLOUD_USER = "your-apple-id@email.com";
const ICLOUD_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx"; // Apple App-Specific Password
const ICLOUD_CAL_NAME = "小惡魔行事曆";
const TIMEZONE = "Asia/Taipei";
const SYNC_INTERVAL_MINUTES = 1; // 分鐘級增量同步週期

module.exports = {
  ICLOUD_USER,
  ICLOUD_APP_PASSWORD,
  ICLOUD_CAL_NAME,
  TIMEZONE,
  SYNC_INTERVAL_MINUTES,
};
```

**server/config/secrets.js**（集中載入，方便日後切換來源）

```js
// server/config/secrets.js
const iCloud = require("../../tokens/icloud.js");

export const secrets = {
  ICLOUD_USER: iCloud.ICLOUD_USER,
  ICLOUD_APP_PASSWORD: iCloud.ICLOUD_APP_PASSWORD,
  ICLOUD_CAL_NAME: iCloud.ICLOUD_CAL_NAME,
  TIMEZONE: iCloud.TIMEZONE,
  SYNC_INTERVAL_MINUTES: iCloud.SYNC_INTERVAL_MINUTES,
};
```

**使用方式**

```js
// 例：server/bootstrap.js
import { secrets } from "./config/secrets.js";

console.log("Sync as:", secrets.ICLOUD_USER);
// 在 CalDAV client、Scheduler、Worker 中引用 secrets.*
```

**.gitignore 推薦**

```
/tokens/
/tokens/*.js
!tokens/README.md
```

**CI/CD 建議**

* 以 CI Secret 生成 `tokens/icloud.js`（例如於 pipeline 中 echo 至檔案）。
* 本地開發直接手動建立 `tokens/icloud.js`；**嚴禁**提交至 Git。

**Migration Note**

* 若文件前面仍留有「.env」示例，請以本段「tokens/*.js」為準。
