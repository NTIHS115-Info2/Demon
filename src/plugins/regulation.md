### 插件架構規範

## 基本目錄結構
```
/plugins/
└── <plugin-name>/
    ├── setting.json          ← 插件設定檔，僅負責描述名稱、優先度與類型
    ├── index.js              ← 插件邏輯入口，不得放置設定常數
    ├── utils/                ← 共用工具模組（選用）
    ├── strategies/           ← 各策略實作（選用）
    └── README.md             ← 插件說明文件（選用）
```

## setting.json 設定格式
```json
{
  "name": "alpha",
  "priority": 10,
  "pluginType": "LLM"
}
```
- **name**：必填，字串，插件唯一識別名稱，PluginsManager 會以小寫名稱建立索引。
- **priority**：必填，整數，數值越大越優先啟動，可於執行期間由插件自行調整。
- **pluginType**：選填，字串，允許值為 `"LLM"`、`"Tool"`、`"Other"`，不填視為一般工具插件。
- 若缺少必填欄位或型別不符，PluginsManager 會將該插件標記為無效並略過。

## index.js 實作守則
- 僅保留程式邏輯與接口實作，不得再定義 `priority` 或 `pluginType` 等設定常數。
- 避免在模組載入階段執行具副作用的程式碼（例如立即啟動服務或建立連線）。
- 模組需輸出以下 `async` 函式，並可視需求提供額外方法：
  - `updateStrategy(options)`：更新運行策略或模式。
  - `online(options)`：啟動插件。
  - `offline()`：關閉插件。
  - `restart(options)`：重啟插件。
  - `state()`：回傳整數狀態，`1` 表示在線、`0` 表示離線、`-1` 表示內部錯誤、`-2` 表示未實作。
  - `send(payload)`：選填，用於資料交握，返回 `Promise`。

## PluginsManager 載入流程
1. **掃描階段**：巡覽每個插件資料夾並讀取 `setting.json`。
2. **驗證階段**：檢查 `name`、`priority` 與 `pluginType` 的合法性，並確認 `index.js` 是否存在。
3. **登錄階段**：將合法設定存入註冊表與目錄索引；若設定出現錯誤則記錄於無效清單。
4. **啟動階段**：僅在實際需要時才 `require('./index.js')`，並再次檢查接口是否齊全後執行。
5. **無效插件追蹤**：可透過 `pluginsManager.getInvalidPlugins()` 取得所有錯誤設定的目錄、原因與紀錄時間。

## LLM 插件附加要求
- `pluginType` 必須設定為 `"LLM"`，並遵循一般插件的接口規範。
- 插件根目錄需額外提供 `tool-description.json`，詳細描述工具功能、參數與回傳格式。
- LLM 插件不直接呼叫 `send()`，而是由 Prompt 中嵌入 JSON 指令，由系統解析後轉交插件執行。
- PluginsManager 會根據設定資訊建立 LLM 工具索引，僅合法的設定檔才會被納入列表。
