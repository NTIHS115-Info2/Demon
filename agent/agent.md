## 📦 Project Overview

* **Name**: WeatherSystem
* **Purpose**:
  這是一個 LLMTool，提供台灣氣象資料的存取能力，並整合 10 種不同的 API，包括一般天氣預報、鄉鎮天氣、觀測站資料、紫外線指數、地震報告及各類天氣特報。

  * **GetWeather36h**：今明 36 小時天氣預報
  * **GetWeatherWeekly**：一週縣市天氣預報
  * **GetTownWeather**：鄉鎮未來 1 週天氣預報
  * **GetStationWeatherNow**：氣象觀測站現在天氣觀測報告
  * **GetRainfallNow**：自動雨量站雨量觀測資料
  * **GetUVIndex**：每日紫外線指數最大值
  * **GetEarthquakeReport**：顯著有感地震報告
  * **GetHeavyRainAlert**：豪大雨特報
  * **GetColdAlert**：低溫特報
  * **GetTyphoonAlert**：颱風消息與警報

### Issues #87–#96 功能與遷移對照

* **#87 一般天氣預報—今明36小時天氣預報**
  舊系統依賴 DB `fu_weather`；新系統直接調用 API 即時回傳。
* **#88 一週縣市天氣預報**
  舊系統批次存 JSON；新系統直接 API 即時查詢。
* **#89 鄉鎮一週天氣預報**
  舊系統批次下載；新系統直接 API 即時查詢。
* **#90 氣象觀測站即時資料**
  舊系統寫入 `now_weather`；新系統直接 API 即時回傳。
* **#91 自動雨量站**
  舊系統未獨立處理；新系統可直接新增 API 查詢。
* **#92 紫外線指數**
  舊系統未處理；新系統直接 API。
* **#93 地震報告**
  舊系統無此功能；新系統直接新增 API 功能。
* **#94 豪大雨特報**
  舊系統未整合；新系統使用 CAP API。
* **#95 低溫特報**
  舊系統未提供；新系統直接 API。
* **#96 颱風警報**
  舊系統未整合；新系統直接 API。

**總結**：新架構全面改為「接收請求 → 呼叫氣象局 API → 處理 → 輸出」，不再依賴 DB 或批次快取，確保資料即時更新並簡化維護。

---

## 🛠 Tools & Permissions

* **Access scope**: Full access

---

## 🔄 Planning / Scheduling

* **Dependencies**:

  * 內部工具：`logger`（用於紀錄與除錯訊息）
  * 外部工具：`https`（用於使用 API）

---

## 🎯 Success Criteria

* 在批量測試中，所有 API 調用均能透過內部 mock 測試成功
* 在單次外部測試中，能正確調用真實 API 並回傳有效結果
* 每個 API 腳本的基礎功能均可正常執行

---

## ⚠️ Limits & Safeguards

* API 調用次數需設限，以避免觸發外部氣象資料服務的流量限制
* 若外部 API 回傳錯誤或逾時，系統需自動重試一次，最多兩次
* 測試環境需使用 mock http 避免對外部 API 造成不必要負載（除了外部調用測試）
* 不應快取超過 24 小時的資料，以確保氣象資訊即時性（即時資料不超過 30 分鐘，預測資料不超過 12 小時）
* 遵循 LLMTool 撰寫規範，避免接口設計與框架不符

---

## 🧪 Testing Instructions

* 使用 `yarn test` 執行測試（測試框架為 Jest）

---

## 🧑‍💻 Dev Tips

* 新增工具外部為 Read-only，network 始終為 allowed 狀態
* 舊版本系統（存放於 agent 資料夾下 data 與 functions）僅供參考，新系統不再依賴 MySQL，改為 API 直取直用，不做儲存
* 開發需遵循 **tools 撰寫規範**（僅限 tools 目錄內部）
* 遵循 **LLMTool 撰寫規範**
* **另有目的**：在 tools 內建立 API JSON → Object 的轉換模組，協助維持資料結構整潔

---

## 📝 PR Example

* **PR Title**: \[WeatherSystem] Add Taiwan weather data APIs integration
* **PR Description**:

  ```
  - Purpose: 提供 LLMTool 取得台灣氣象資料，整合 10 種不同 API 調用，並完成 Issues #87–#96 遷移  
  - Tools/Permissions: Full access，新增工具外部 Read-only，network 始終 allowed  
  - Success Criteria: 支援批量 mock 測試與單次真實 API 測試，每個 API 腳本可正確運行  
  - Limits/Safeguards: 設定 API 呼叫上限，自動重試機制，資料快取限制，遵循 LLMTool 與 tools 規範  
  ```

---