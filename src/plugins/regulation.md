### 插件架構規範

## 資料夾架構
/plugins/
└── plugin[name]/
    ├── index.js                ← Plugin 進入點，導出接口以及初始設定值等
    │
    ├── utils/                  ← 存放這個插件內共同使用的func或是功能
    │
    ├── strategies/
    │   ├── local/
    │   │   └── index.js        ← local 策略的實作
    │   └── remote/
    │       └── index.js        ← remote 策略的實作
    └── README.md

## 接口意思說明
- 用來控制plugin的，例如online/offline控制上下線 , send負責與插件互相傳輸資料

## 接口 : index.js （用來負責外部引入使用）
- online
- offline
- restart
- state
- send(選用)
- updateStrategy

## 接口輸入值
- online    -> option{}
- offline   -> nil
- restart   -> option{}
- state     -> nil
- send      -> option{}

## 接口回傳值
- state     -> 會回傳目前狀態 0 為下線 1 為上線 -1 為錯誤 -2 為插件 state 未定義
- send      -> Promise<void>

## 其他要求
- 所有接口函式皆需 async
- `priority` 屬性應在各策略實作的 `index.js` 定義，整數值，數字越大越早啟動，預設 0


### LLM 插件規範

## 基本規範
- LLM 插件與一般插件的結構相同，並遵循相同的接口定義（online, offline, state, send, updateStrategy 等）
- 所有接口函式必須為 `async` 函數
- 插件根目錄需額外提供一份 `tool-description.json` 檔案，為自然語言工具使用說明，內容包含：
  - 工具功能描述
  - 調用格式範例（JSON 格式）
  - 回傳格式範例
  - 可選輸入欄位與限制

## 調用方式與設計原則
- LLM 不直接呼叫 `send()`，而是透過 prompt 中插入 JSON 請求，並由系統中介程式擷取後轉交插件執行 `send(option)`
- 插件只需要如同一般插件般實作 `send()` 函式，無需處理 LLM 結構
- LLM 插件會透過 `pluginsManager` 額外輸出其工具說明資訊，用來建立 LLM 工具索引
  - 僅當插件提供 `tool-description.json`，才會被註冊為 LLM 工具插件
