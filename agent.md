# 本次需更新的規格項目（給開發與 QA）

以下內容為 **必須新增 / 變更** 至現行 `timeService` 規格的部分；請直接將這些條目合併進既有文件中。

---

## 1. 新增輸入欄位（精確定義）

### 1.1 `baseTime`（可選，字串）

* **格式**：`YYYY-MM-DD hh:mm:ss`（24 小時制）
* **含義**：作為時間差或偏移運算的「基準時間點」。若存在且同時有 `targetTime`，則以此為基準（偏移會套用在此基準上，詳見第 2 節）。
* **備註**：若**僅**提供 `baseTime`（未提供 `targetTime`），此欄位不會觸發差距計算，將被視為「無效輸入」並回傳錯誤碼 `IGNORED_BASE_ONLY`。

### 1.2 `targetTime`（可選，字串）

* **格式**：`YYYY-MM-DD hh:mm:ss`（24 小時制）
* **含義**：欲與基準時間比較的目標時間點。若只提供 `targetTime`，系統將以「當前時間（依 timezone 調整）」為基準計算時間差距。

> **重要提醒**：`baseTime` 與 `targetTime` 均為**實際時間點**（不應與偏移欄位混用作為偏移描述）；偏移欄位 (`Y/M/D/h/m/s`) 是獨立的「偏移量」，僅作用於基準時間（詳見第 2 節）。

---

## 2. 偏移與差距計算的優先順序與交互規則（核心業務邏輯）

### 2.1 建立基準時間（base）

* 若 `baseTime` 存在 → 設定 `base = parse(baseTime)`
* 若 `baseTime` 不存在 → 以 `now()`（依 `timezone` 調整後的當地時間）作為 `base`

### 2.2 套用偏移量（Y/M/D/h/m/s）

* 偏移量**僅套用於基準時間 `base`**（不會影響 `targetTime`）
* 套用順序建議：Y → M → D → h → m → s（以正確處理跨月、跨年與閏月情況）
* 若同時提供 `baseTime` 與偏移：先解析 `baseTime`，再套用偏移得到最終基準時間

### 2.3 差距計算規則

1. **同時存在基準與目標時間**：若同時存在 `baseTime`（或經偏移後的 `base`）與 `targetTime` → 回傳時間差距：`diff = targetTime - base`（以秒為單位，含正負號）
2. **僅有目標時間**：若僅有 `targetTime` → `base = now()`（含 timezone 與偏移調整）→ `diff = targetTime - base`
3. **僅有基準時間**：若僅有 `baseTime`（且沒有 `targetTime`）→ **不執行差距計算**；回傳錯誤碼 `IGNORED_BASE_ONLY`

### 2.4 時間差距符號定義

* `diff > 0`：`targetTime` 在 `base` 之後（未來時間）
* `diff < 0`：`targetTime` 在 `base` 之前（過去時間）

---

## 3. 輸出格式變更（新增欄位與規範）

### 3.1 時間結果輸出

當輸出為「時間」結果（非差距）時：

```json
{
  "result": "YYYY-MM-DD hh:mm:ss (UTC+X)",
  "resultType": "time"
}
```

### 3.2 差距結果輸出

當輸出為「時間差距」結果時：

```json
{
  "result": "YYYY-MM-DD hh:mm:ss",
  "resultType": "time"
}
```

* `resultType` 必為 `"time"`，以便上層系統快速判斷處理流程

---

## 4. 測試範例

請針對以下情況加入單元測試：

### 4.1 差距計算：同時提供 baseTime 與 targetTime（含偏移）

* **測試用例**：`baseTime="2025-08-23 12:00:00"`, `targetTime="2025-08-23 15:30:00"`, `h=1`（偏移套用在 base）
* **驗證重點**：先將偏移套用於 base → 再計算 diff（確認順序與數值正確）

### 4.2 僅提供 targetTime（相對於當前時間）

* **測試用例**：僅輸入 `targetTime`（含 timezone）
* **驗證重點**：確認 diff = target - (now adjusted)；使用固定時間模擬 now 進行斷言

### 4.3 僅提供 baseTime（被忽略的情況）

* **測試用例**：僅輸入 `baseTime`
* **驗證重點**：應回傳 `IGNORED_BASE_ONLY` 錯誤碼，且不返回 `resultType:"diff"`

---

## 5. 實作順序建議（開發工作流程）

1. **輸入處理**：接收原始輸入（raw text 或 JSON payload）
2. **資料驗證**：JSON 解析與欄位型別驗證
3. **基準建構**：建構 `base`（含 timezone 調整），套用偏移量
4. **結果計算**：決策並計算（時間輸出或差距輸出）
5. **格式化回傳**：按照規定格式輸出結果
6. **錯誤處理**：若發生錯誤或異常，按照錯誤碼規範回傳

---

## 6. 設計備註（重要提醒）

* **偏移作用範圍**：偏移量只作用於基準時間，請在程式中註明此設計決策，避免未來誤將偏移套用到 `targetTime`
* **時區處理**：確保所有時間計算都正確處理時區轉換
* **錯誤處理**：建立完整的錯誤碼體系，便於除錯與維護

---