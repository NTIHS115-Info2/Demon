一般天氣預報-今明36小時天氣預報 一般天氣預報-今明36小時天氣預報 #87（F‑C0032‑001）：提供各縣市今明 36/12 小時分段預報，包含天氣現象（Wx）、最高溫（MaxT）、最低溫（MinT）、降雨機率（PoP）與舒適度指數（CI）等。查詢參數：locationName、format。回傳欄位包含 datasetDescription、locationName、elementName（Wx、MaxT、MinT、CI、PoP）、startTime、endTime、parameterName、parameterValue、parameterUnit 等。
一般天氣預報-一週縣市天氣預報 一般天氣預報-一週縣市天氣預報 #88（F‑C0032‑005）：提供各縣市未來一週天氣趨勢，含最高/ 最低溫、降雨機率、舒適度等天氣現象。查詢參數：locationName、format。回傳欄位包含 datasetDescription、locationName、elementName（Wx、MaxT、MinT、CI、PoP 等）、startTime、endTime、parameterName、parameterValue、parameterUnit 等。
鄉鎮天氣預報-臺灣未來1週天氣預報 鄉鎮天氣預報-臺灣未來1週天氣預報 #89（F‑D0047‑093）：提供鄉鎮未來七日詳細預報，可自選氣溫（T）、相對溼度（RH）、風向（WD）、風速（WS）等工作項目及時間範圍。查詢參數：locationName、elementName、timeFrom、timeTo、format。回傳欄位包含 datasetDescription、locationName、elementName、startTime、endTime、parameterName、parameterValue、parameterUnit 等。
氣象觀測站-現在天氣觀測報告 氣象觀測站-現在天氣觀測報告 #90（O‑A0003‑001）：提供氣象觀測站每 10 分鐘更新的即時氣象，包含溫度、溼度、風向風速等觀測資料。查詢參數：locationName、format。回傳欄位包含 stationId、stationName、lat、lon、county、town、obsTime 及 weatherElement（TEMP、HUMD、WDIR、WDSD 等）。
自動雨量站-雨量觀測資料 自動雨量站-雨量觀測資料 #91（O‑A0002‑001）：提供自動雨量站每 10 分鐘更新的雨量資料，包含累積雨量（10 分、3/6/12/24 小時）。查詢參數：locationName、format。回傳欄位包含 stationId、stationName、lat、lon、county、town、obsTime 及 rainfallElement（RAIN、HOUR_3、HOUR_6、HOUR_12、HOUR_24 等）。
紫多級觀測-每日紫多級指數最大值 紫外線指數-每日紫外線指數最大值 #92（O‑A0005‑001）：提供各地測站當日約下午 2 時的最大紫多級指數。查詢參數：locationName 或 stationId、format。回傳欄位包含 siteName/stationName、county、town、publishTime、uvIndex 等。
震度與地震報告 顯著有感地震報告 #93（E‑Q0015‑001）：提供有感或要稱型比較大的地震報告，資訊包含地震時間、震心位置、深度、震度分佈及要稱資料。查詢參數：format。回傳欄位包含 reportNo、originTime、epicenterLat、epicenterLon、depth、magnitude、maxIntensity、intensityArray 等。
豹雨特報 天氣特報-豪大雨特報 #94（W‑C0033‑004）：發射在預測豹雨或大豹雨時的警訊，含發佈時間、生效期限、影響區域及注意事項。查詢參數：format。回傳欄位採 CAP 格式，包含 identifier、sent、effective、expires、event、severity、urgency、certainty、area、headline、description、instruction 等。
低溫特報 天氣特報-低溫特報 #95（W‑C0033‑003）：當預溫位置達到警戒門樑時發佈，內容包含發佈時間、有效期限、影響區域、預溫門樑及應注意事項。查詢參數：format。回傳欄位與豹雨特報類似，包含 identifier、sent、effective、expires、event、threshold、area、headline、description、instruction 等。
颱風資訊與警報 颱風消息與警報-颱風警報 #96（W‑TYP‑002）：提供颱風警報相關資訊，包含訊息編號、發佈時間、警報類型（海上或陸上警報）、颱風編號與名稱、中心位置、氣壓、風暴半徑及影響區域描述等。查詢參數：format。回傳欄位包含 identifier、sent、event、typhoonId、typhoonName、centerLat、centerLon、pressure、windRadius、area、headline、description、instruction 等。

### #87 一般天氣預報—今明36小時天氣預報
- **功能內容：** 提供各縣市未來 36 小時每 12 小時的天氣預報，包含天氣現象、最高/最低溫、降雨機率、舒適度等。API 參數包含 locationName、format 等。
- **舊系統狀態：** 舊系統透過氣象局 F-C0032-001 API 取得臺南市等預報並儲存於資料庫 `fu_weather`，Discord 機器人查詢時讀取資料庫回傳。
- **遷移建議：** 新系統可直接呼叫氣象局 API 即時回傳，不再需要資料庫，功能可完全遷移。

### #88 一般天氣預報—一週縣市天氣預報
- **功能內容：** 提供各縣市未來一週天氣趨勢預報。API 參數 locationName、format 等。
- **舊系統狀態：** 舊系統批次抓取鄉鎮級一週預報並存成 JSON 檔供分析，沒有提供前端查詢。
- **遷移建議：** 新系統可直接即時調用一週預報 API 完成此功能。

### #89 鄉鎮天氣預報—臺灣未來1週天氣預報
- **功能內容：** 提供各鄉鎮未來三天逐 3 小時及一週逐日預報，包含溫度、濕度、風向等。參數 locationName、elementName、timeFrom/to、format。
- **舊系統狀態：** 舊系統每天批次下載全臺鄉鎮 7 日預報並轉存 JSON，以備離線分析，未提供即時查詢。
- **遷移建議：** 新系統可透過即時 API 查詢個別鄉鎮，不需要批次存檔，功能可遷移。

### #90 氣象觀測站—現在天氣觀測報告
- **功能內容：** 提供氣象觀測站即時觀測資料（每 10 分鐘更新），如氣溫、風速、風向、氣壓等。
- **舊系統狀態：** 舊系統每小時抓取指定站的觀測資料寫入 `now_weather` 表，機器人再從資料庫讀取並更新 Discord 頻道名稱。
- **遷移建議：** 新系統直接查詢氣象局 API 即時取得指定站點資料，不需資料庫即可滿足功能。

### #91 自動雨量站—雨量觀測資料
- **功能內容：** 提供各雨量站每 10 分鐘即時雨量及累積雨量。參數 locationName、format。
- **舊系統狀態：** 舊系統沒有獨立使用此 API，僅在觀測站資料中包含降水量欄位。
- **遷移建議：** 新系統可直接新增雨量站查詢功能，透過 API 回傳所需資訊。

### #92 紫外線指數—每日紫外線指數最大值
- **功能內容：** 每日各站點 UV 指數最大值資料，每日下午 2 時更新。參數 locationName/stationId、format。
- **舊系統狀態：** 舊系統未處理 UV 指數。
- **遷移建議：** 新系統直接使用氣象局 API 提供此功能。

### #93 顯著有感地震報告
- **功能內容：** 提供規模較大且明顯有人感受到的地震報告，包括時間、震央、深度、規模、震度分布等。
- **舊系統狀態：** 舊系統沒有地震相關功能。
- **遷移建議：** 新系統可直接加入此功能，調用 API 即時回傳。

### #94 天氣特報—豪大雨特報
- **功能內容：** 當可能發生大雨或豪雨時發出特報，提供警報內容、生效/解除時間、事件類型、受影響區域、防災建議等。
- **舊系統狀態：** 舊系統未整合豪雨特報。
- **遷移建議：** 新系統可直接透過 CAP 格式 API 提供豪雨特報。

### #95 天氣特報—低溫特報
- **功能內容：** 氣溫預測低於 10℃ 時發布低溫特報，含生效/截止時間、事件類型、受影響區域、低溫門檻、說明等。
- **舊系統狀態：** 舊系統未提供低溫特報。
- **遷移建議：** 新系統可直接使用 API 提供此功能。

### #96 颱風消息與警報—颱風警報
- **功能內容：** 提供颱風警報資訊，包括颱風編號名稱、發布時間、中心位置及氣壓、風圈半徑、警戒區域、多邊形範圍及防災建議等。
- **舊系統狀態：** 舊系統未整合颱風警報。
- **遷移建議：** 新系統可直接透過氣象局颱風警報 API 即時回傳資訊。

**總結：** 上述功能均可透過中央氣象署開放資料 API 在新架構下直接取得與輸出。不再需要舊系統中以資料庫儲存或批次抓取的方式，亦可省略多餘的本地快取邏輯。新系統將專注於接收請求→呼叫 API→處理→輸出，能簡化維護並確保資料即時更新。