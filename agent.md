# agent.md

## 📦 Project Overview
- **Name**: complete-ci-test-coverage  
- **Purpose**: 建立完整的 CI 自動化測試流程，涵蓋單元測試、插件測試、整合測試與端到端測試，確保每次程式更新不會破壞核心功能或插件協作，並能及早發現潛在問題，維持系統穩定性與品質。  

## 🛠 Tools & Permissions
- **Access scope**: Full access  

## 🔄 Planning / Scheduling
- **Dependencies**:  
  - Jest (單元與整合測試框架)  
  - GitHub Actions (CI pipeline 執行環境)  

## 🎯 Success Criteria
- Core/Utils/Tools 單元測試全綠，涵蓋主要邊界情境，測試覆蓋率 ≥ 80%  
- 每個 Plugin 的必要介面（依 `plugins/regulation.md` 規範：online、offline、restart、state、send、updateStrategy）皆有測試並通過，包括：  
  - 介面存在檢查  
  - 參數驗證  
  - 錯誤處理（非法輸入、內部例外）  
- 核心↔插件整合流（含多插件串聯，如 ASR→Core→LLM→Core→TTS）能在 CI 中完整跑通，並於並發 N=5 的情況下無 race condition 與資源洩漏  
- 端到端關鍵用例（使用者視角）最少 2 個案例全綠，輸出格式與內容符合預期（固定測試帳號/資料、無外部實體呼叫）  

## ⚠️ Limits & Safeguards
- 測試環境與生產環境嚴格隔離，所有插件測試均使用 mock/stub 或測試專用配置，避免觸發真實外部服務  
- 端到端測試只需撰寫測試腳本，並在 CI 中與一般測試隔離（透過調整 `jest.e2e.config.js` 配置），避免因需求龐大拖慢 pipeline  
- 並發測試僅在受控環境執行，避免造成 CI 節點資源耗盡  
- Bug 修復必須附帶回歸測試，確保問題不會再次出現  

## 🧪 Testing Instructions
- 單元測試：針對 core/utils/tools 執行 `pnpm test --filter <project>` 或 `pnpm jest -c jest.config.js --coverage`  
- 插件測試：以 mock/stub 方式測試 plugin API（online、offline、restart、state、send、updateStrategy），避免啟動真實服務  
- 整合測試：模擬 core 與 plugin 的交互（含多插件串聯、錯誤傳播、併發情境）  
- 端到端測試：從使用者輸入到最終輸出全流程驗證，僅保留少量核心案例，以 `pnpm jest -c jest.e2e.config.js --runInBand` 執行  
- CI 流程：將單元/插件/整合/端到端測試全部納入 `.github/workflows`，任何失敗即阻止合併  
- 覆蓋率與回歸測試：修正 bug 時新增測試案例，維持高測試覆蓋率  

## 🧑‍💻 Dev Tips
- 測試分層命名：`*.spec.js`（unit/integration）、`*.e2e.spec.js`（e2e）  
- 兩份設定：`jest.config.js`（unit/integration，含 `coverageThreshold: { global: { lines: 80 } }`）與 `jest.e2e.config.js`（E2E；較長 `testTimeout`、`runInBand`、獨立報告）  
- CI 隔離：  
  - Unit/Integration：`pnpm jest -c jest.config.js --coverage --maxWorkers=50%`  
  - E2E：`pnpm jest -c jest.e2e.config.js --runInBand`  
- 并發與資源：unit/integration 用 `--maxWorkers=50%`；E2E 一律 `--runInBand`  
- 失敗重試：對易受時序影響的案例加 `jest.retryTimes(2)`  
- 假資料與清理：使用 `__fixtures__/`；於 `afterEach` 清理檔案/連線，避免測試汙染  
- 網路隔離：預設 mock `fetch`/`axios`，禁止真實外連；plugins 測試以 stub 取代外部服務  
- 時間控制：`jest.useFakeTimers()`、`jest.setSystemTime()` 固定時基  
- 插件介面共用測試骨架：檢查 `online/offline/restart/state/send/updateStrategy` 是否存在、參數驗證與錯誤處理  
- Monorepo（若有）：以 Jest projects 或 `pnpm --filter` 分流；E2E 保持獨立專案/設定  
- CI 快取：快取 `node_modules` 與 `~/.cache/jest`  
- 資訊可觀測性：標準化 `console.error` 攔截與結構化日誌輸出（失敗時帶上 plugin 名稱、請求 ID、測試案例名），方便排查  

## 📝 PR Example
```
- **PR Title**: [complete-ci-test-coverage] 補充完整的 CI 測試覆蓋率  
- **PR Description**: Project purpose: 建立完整的 CI 自動化測試流程，涵蓋單元測試、插件測試、整合測試與端到端測試，確保更新不破壞核心功能與插件協作

Tools/Permissions: 使用 Jest 與 GitHub Actions，Full access 權限

Success Criteria:

Core/Utils/Tools 測試覆蓋率 ≥ 80%

Plugins 接口（online/offline/restart/state/send/updateStrategy）皆有測試通過

核心↔插件整合流與多插件串聯能完整執行，並發 N=5 無 race condition

至少 2 個端到端用例驗證成功，輸出格式與內容符合預期

Limits/Safeguards:

測試環境與生產隔離，插件測試使用 mock/stub

E2E 測試以獨立腳本與 jest.e2e.config.js 執行，避免干擾一般測試

并發測試僅於受控環境進行

Bug 修復需附帶回歸測試
```