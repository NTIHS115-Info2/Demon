#### WeatherSystem 插件更新紀錄

### [v0.1]
## New
- 新增 WeatherSystem 插件，整合中央氣象署 10 種氣象 API 直取功能

### [v0.2]
## Change
- 改為本地策略模式，移除遠端實作
- API 金鑰改由根目錄 `tokens/cwa.js` 讀取
- 補充使用說明與工具描述

### [v0.3]
## Change
- 工具描述補充 10 種可用 API 清單

### [v0.4]
## Change
- 工具描述新增各 API 可自訂參數並預設使用臺南市

### [v0.5]
## Test
- 新增 WeatherSystem 本地策略單元測試，驗證速率限制、錯誤處理與預設參數合併

