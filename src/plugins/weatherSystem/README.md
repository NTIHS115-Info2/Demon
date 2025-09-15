# WeatherSystem 插件

提供中央氣象署開放資料 API 查詢功能，整合 10 種常用氣象服務。若未指定查詢參數，系統將以臺南市作為預設地點。

## 支援的 API 與可自訂參數
- GetWeather36h：今明 36 小時天氣預報
  - `locationName`：縣市名稱（預設：臺南市）
- GetWeatherWeekly：一週縣市天氣預報
  - `locationName`：縣市名稱（預設：臺南市）
- GetTownWeather：鄉鎮一週天氣預報
  - `locationName`：縣市名稱（預設：臺南市）
  - `townName`：鄉鎮名稱（預設：中西區）
- GetStationWeatherNow：氣象觀測站即時資料
  - `stationId`：測站 ID（預設：467410 臺南測站）
- GetRainfallNow：自動雨量站雨量
  - `stationId`：雨量站 ID（預設：467410 臺南測站）
- GetUVIndex：每日紫外線指數最大值
  - `locationName`：縣市名稱（預設：臺南市）
- GetEarthquakeReport：顯著有感地震報告
  - 無可自訂參數
- GetHeavyRainAlert：豪大雨特報
  - `locationName`：縣市名稱（預設：臺南市）
- GetColdAlert：低溫特報
  - `locationName`：縣市名稱（預設：臺南市）
- GetTyphoonAlert：颱風警報
  - `locationName`：縣市名稱（預設：臺南市）

## 使用方式
```javascript
const PM = require('../core/pluginsManager');
await PM.loadPlugin('weatherSystem');
await PM.queueOnline('weatherSystem');
const result = await PM.send('weatherSystem', {
  apiName: 'GetWeather36h',
  // 未提供 params 時將自動以臺南市為查詢地點
  params: { locationName: '臺北市' }
});
console.log(result);
```

## 設定 API 金鑰
在專案根目錄建立 `tokens/cwa.js`（此資料夾已被 `.gitignore` 排除），內容如下：

```javascript
module.exports = { CWA_API_KEY: '你的金鑰' };
```

## 注意事項
- 每分鐘最多 60 次呼叫，超過將回傳錯誤
- 若 API 回應錯誤或逾時，系統會自動重試一次
- 未設定 API 金鑰時將無法正常呼叫氣象資料
