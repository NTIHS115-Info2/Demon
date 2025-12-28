# 策略選擇 Resolver 規格 (Strategy Resolver Specification)

## 1. 目的與範圍

本文件定義 `pluginsManager` 的「策略選擇 resolver」行為：

- **hard filter**（requirements + policy）
- **scoring**（打分）
- **tie-break**（同分決勝）
- **fallback**（啟動或健康失敗的降級鏈）
- **deterministic**（結果可重現）

## 2. 選擇流程（固定順序）

給定一個 capability（或一組候選 strategies）：

1. **收斂候選**：收集所有可能提供該 capability 的 strategies
2. **Hard Filter**：requirements 不滿足或 policy 禁止 → 淘汰
3. **Scoring**：對剩餘候選計算 score（越高越好）
4. **Tie-break**：確保 deterministic
5. **選擇第一名**：作為 provider
6. **啟動失敗 / health fail**：啟動 fallback chain

## 3. Hard Filter（硬條件）

候選 strategy 必須同時滿足：

- `requirements.platform` / `runtime` / `resources` / `network` / `env` / `permissions`
- manager **policy**（例如禁用 experimental、禁用某 executor、禁止某 net 目標等）
- （若能力請求帶 context）可加入 **request-level 限制**（例如禁止 remote）

> ⚠️ **不滿足即淘汰，不進入 scoring。**

## 4. Scoring（線性模型，可調權重）

### 4.1 Score 定義

採線性可解釋模型（可重現）：

```
score = Wp × priority
      + Ws × stability
      - Wc × cost
      - Wr × risk
```

其中變數如下：

| 變數 | 說明 | 範圍 |
|------|------|------|
| `priority` | `strategy.priority` | 0~100 |
| `stability` | `1 - cost.stabilityRisk` | 0~1 |
| `cost` | 由 `startup`/`latency`/`memory`/`gpu` 正規化後加總 | 0~1 或 0~N |
| `risk` | 由 `riskClass`/`isExperimental`/`executor` 類型風險推導 | 0~1 或 0~N |

### 4.2 executor 類型的預設風險（可被 policy 覆寫）

建議初始值（之後可調）：

| executor 類型 | 預設風險值 | 說明 |
|---------------|-----------|------|
| `in_process` | 0.10 | 共享崩潰風險 |
| `worker` | 0.15 | 隔離但有額外管理成本 |
| `child_process` | 0.20 | 啟動成本與 IPC 開銷 |
| `remote` | 0.30 | 網路不確定性 |

### 4.3 預設權重（可被 config 覆寫）

|變數|數值|說明|
|----|----|------|
| Wp | 1.0 | priority 權重 |
| Ws | 30.0 | stability 權重 |
| Wc | 10.0 | cost 權重 |
| Wr | 20.0 | risk 權重 |

**核心原則**：priority 決定大方向，穩定性與風險能強力拉開差距，成本次之。

## 5. Tie-break（同分決勝，必須固定）

若 score 相同，依序比較：

1. `priority`（desc）
2. `riskClass`（asc）
3. `cost.stabilityRisk`（asc）
4. `version`（desc，semver）
5. `id`（asc，字典序，確保 deterministic）

## 6. Fallback（降級鏈）

當選定的 strategy：

- 啟動失敗（spawn fail / connect fail / init throw）
- 或健康檢查失敗（healthcheck）

則依序嘗試：

1. `strategy.fallback[]` 中列出的 strategy ids
2. 若 fallback 用完仍失敗 → 回報 `STRATEGY_UNAVAILABLE`

> ⚠️ **fallback 嘗試同樣必須套用 hard filter + policy**（不能繞過安全限制）。

## 7. 最小測試案例（必測）

### 7.1 多策略選擇
**測試場景**：同 capability 多策略  
**預期行為**：GPU/非 GPU 環境下選擇不同 provider

```typescript
// GPU 環境應選擇 GPU 加速策略
// 非 GPU 環境應選擇 CPU 策略
```

### 7.2 Deterministic Tie-break
**測試場景**：同分 tie-break  
**預期行為**：跑 100 次結果一致

```typescript
// 相同 score 的 strategies 必須每次都選擇同一個
```

### 7.3 Fallback 機制
**測試場景**：fallback  
**預期行為**：首選啟動失敗 → 自動切到 fallback

```typescript
// 主策略失敗時自動降級到備選策略
```

---

**相關文件**：
- [dependency.md](./dependency.md) - 依賴解析規則
- [lifecycle.md](./lifecycle.md) - Plugin 生命週期狀態定義