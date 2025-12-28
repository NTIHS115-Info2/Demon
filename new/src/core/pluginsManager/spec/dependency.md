# 依賴解析規格 (Dependency Resolution Specification)

## 1. 目的與範圍

本文件定義 `pluginsManager` 的「依賴解析」行為，包含：

- plugin 之間的必需/可選/條件式依賴
- 依賴的滿足條件與版本約束
- 依賴觸發時機（eager vs lazy）
- 循環依賴（cycle）處理策略
- 對 `type=capability` 的 provider 選擇規則（會與 resolver 對齊）

**本規格不定義 plugin 內部實作細節，只定義 pluginsManager 的行為。**

## 2. 名詞定義

| 術語 | 說明 |
|------|------|
| **PluginSpec** | 單一插件的自述文件（manifest） |
| **Strategy** | 同一插件的某個執行方案（`in_process`/`worker`/`child_process`/`remote`） |
| **Capability** | 抽象能力字串，例如 `llm.chat` |
| **Provider** | 實際提供某 capability 的 `(pluginId, strategyId)` |
| **Dependency** | 依賴項，`type=plugin` 或 `type=capability` |
| **Satisfy（滿足）** | 依賴已被系統確認可用 |

## 3. 依賴類型與語意

### 3.1 `dependencies.required`

- **語意**：必需依賴。若未滿足,目標 plugin（或目標策略）不得進入 `starting`。
- **時機**：Eager（啟用前就解析並嘗試滿足）。
- **失敗策略**：Fail fast（直接拒絕啟用,回傳明確錯誤）。

### 3.2 `dependencies.optional`

- **語意**：可選依賴。未滿足時 plugin 仍可啟用,但對應增強功能不得宣告可用。
- **時機**：不強制滿足；可在啟用後嘗試補齊（非必要）。

### 3.3 `dependencies.conditional`

- **語意**：條件式依賴。只有在指定條件成立時才需要滿足（用於「不是所有時候都開啟所有插件」）。
- **時機**：Lazy（由能力請求或策略選擇觸發）。
- **條件**：
  - `whenCapabilities`: 當指定 capability 被請求/使用時觸發（預設主路徑）
  - `whenStrategy`: 當指定 strategy 被選中後觸發（補充路徑）

## 4. 依賴項（DependencySpec）的滿足條件

### 4.1 `type=plugin`

滿足條件（Satisfy）為：

1. 系統中存在該 `pluginId`
2. 若指定 `version` 約束,則版本符合
3. `pluginsManager` policy 不禁止該 plugin
4. 該 plugin 至少有一個 strategy 通過 requirements 並可啟動
5. 該 plugin 被成功啟用至 `running`（或至少可提供被依賴能力）

> **規範**：`required` 依賴必須達到 `running` 才算滿足。`optional` 可放寬（僅需可解析到 provider 也可）。

### 4.2 `type=capability`

滿足條件為：

1. 系統中存在至少一個 provider 可提供該 capability
2. provider 的 plugin/strategy 通過 requirements 與 policy
3. provider 最終被啟用至 `running`（在 lazy 路徑中可由本次請求觸發啟用）

## 5. Provider 選擇規則（capability 依賴的關鍵）

當依賴為 `type=capability`,而存在多個 provider 時,選擇規則如下：

1. 取得所有聲稱提供該 capability 的候選 strategies
   - 若 strategy 有 `strategy.capabilities`,以它為準
   - 否則以 `plugin.capabilities` 視為完整提供
2. 對候選策略套用 **Hard Filter**（requirements + policy）
3. 使用 **Resolver Scoring**（見 `resolver.md`）排序
4. 使用 **Tie-break**（見 `resolver.md`）確保 deterministic
5. 取排序第一名作為 provider

> ⚠️ **重要**：依賴解析與 capability 路由必須共享同一套 resolver 規則,否則會出現「依賴選 A、實際呼叫選 B」的矛盾。

## 6. 解析流程（Algorithm）

### 6.1 啟用 plugin（Eager required）

當 `pluginsManager` 決定要啟用某 plugin（或其 strategy）時：

1. 解析 `dependencies.required`
2. 對每個 dependency：
   - `type=plugin`：遞迴啟用目標 plugin（但需 cycle guard）
   - `type=capability`：先透過 resolver 選 provider,再啟用該 provider 的 plugin/strategy
3. 全部 required 成功滿足 → 目標 plugin 才可進入 `starting`

### 6.2 capability 被請求（Lazy conditional）

當外部呼叫 `invoke(capability, ...)`：

1. 檢查是否已有 provider 在 `running`
2. 若無：
   - 觸發全系統掃描 `dependencies.conditional` 中 `whenCapabilities` 含該 capability 的條目
   - 將其 `requires` 視為「本次請求的 required」
   - 依 6.1 的規則嘗試滿足
3. 仍無 provider → 回傳錯誤 `CAPABILITY_UNAVAILABLE`

> **注意**：`conditional` 不應在系統啟動時全量啟用,必須 lazy。

## 7. 循環依賴（Cycle）處理策略

### 7.1 Required Cycle（必需循環）

若在解析 `required` 時偵測到 cycle：

- 必須立即失敗（Fail fast）
- 錯誤代碼：`DEPENDENCY_CYCLE_REQUIRED`
- 錯誤內容需包含 cycle 路徑（例：`A → B → A`）

### 7.2 Optional/Conditional Cycle

- 不主動啟用以打破循環
- 允許存在,但在真正觸發時若形成 required chain,仍依 7.1 fail

### 7.3 Cycle 偵測機制（規範）

- 使用 DFS stack（或顯式 path set）追蹤「當前解析鏈」
- 解析入口需帶 `traceId` 以便 log 與除錯

## 8. 版本約束（version）

Schema 允許 `version` 字串,但解析行為由 `pluginsManager` 定義：

- 建議使用 semver range（如 `>=1.2.0`）
- 若無法解析版本字串：
  - `required`：失敗（`DEPENDENCY_VERSION_INVALID`）
  - `optional`：忽略該依賴（記 log）

## 9. 錯誤碼（標準化）

| 錯誤碼 | 說明 |
|--------|------|
|DEPENDENCY_MISSING_PLUGIN       | 找不到所需的 plugin|
|DEPENDENCY_MISSING_CAPABILITY   | 找不到所需的 capability|
|DEPENDENCY_VERSION_MISMATCH     | 版本不符合約束|
|DEPENDENCY_VERSION_INVALID      | 版本字串無效|
|DEPENDENCY_POLICY_DENY          | policy 禁止該依賴|
|DEPENDENCY_CYCLE_REQUIRED       | 偵測到必需依賴循環|
|CAPABILITY_UNAVAILABLE          | capability 無可用 provider|


## 10. 最小測試案例（必測）

1. **基本鏈式依賴**  
   `A.required → B.required → C`（可啟動）

2. **條件式依賴**  
   只有呼叫 `x.y` 才會拉起 plugin D

3. **必需循環**  
   `A.required → B.required → A`（必須 fail fast）

4. **Capability 依賴**  
   同 capability 多 provider,選擇必須 deterministic

---

**相關文件**：
- [resolver.md](./resolver.md) - Provider 選擇與評分規則
- [lifecycle.md](./lifecycle.md) - Plugin 生命週期狀態定義