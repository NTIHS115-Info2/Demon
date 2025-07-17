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
