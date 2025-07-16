## ASR
[x] 更改setting以及架構使其符合plugin要求
[x] 測試檔案

## TTS
[x] 更改setting以及架構使其符合plugin要求
[x] 測試檔案
[ ] 讓語音更好聽一點

## Discord
[ ] 可以登入機器人帳號
[ ] 可以發送訊息
[ ] 可以獲取訊息

## 命令
[ ] 可以根據

## ngork
[x] 讓ngrok可以上線，並有腳本監測3000以及讓插件的remote方式可以註冊對外接口

## 啟動腳本
[X] 

## 小惡魔的對話設定
[X] 對<>的前綴附加詞的說明設定


### ✅ PluginsManager 優先度功能 ToDo List

## 📌 主要目的

- 為 `pluginsManager` 加入插件優先度排程功能，每個插件自帶整數型 `priority` 欄位。
- 執行 `queueAllOnline` 時，依 `priority` 高→低排序啟動插件。
- `queueOnline` 加入防呆機制，避免重複上線。
- 各策略 (`strategies`) 的 `index.js` 中導出 `priority` 欄位，與其他函數（如 `online`, `offline`）一同定義。
- 相同優先度的插件保留原始載入順序。
- 更新插件說明文件，納入本次優先度排程的規範。

---

## 📋 開發代辦事項清單

### 1. 定義插件優先度屬性（priority）

- [ ] 設計 `priority` 屬性（int），預設值為 0。
- [ ] 加入至各插件 `index.js` 的導出結構中。

---

### 2. 更新 `queueAllOnline` 排程邏輯

- [ ] 根據插件的 `priority` 欄位進行降序排序。
- [ ] 保留相同 `priority` 插件的載入順序。

---

### 3. 實作 `queueOnline` 防呆機制

- [ ] 檢查插件是否已經在線。
- [ ] 已上線則跳過啟動，並記錄警告 log。

---

### 4. 修改各策略的 `index.js`

- [ ] 新增並導出 `priority` 欄位。
- [ ] 保持與 `online`, `offline` 等欄位一致的結構。

---

### 5. 撰寫測試與驗證邏輯

- [ ] 驗證優先度排序是否正確。
- [ ] 驗證相同優先度插件是否依照原順序啟動。
- [ ] 驗證重複上線防呆機制是否正確攔截。

---

### 6. 更新文件與規範

- [ ] 修改或建立 `regulation.md` 文件。
- [ ] 說明：插件如何設定 `priority`。
- [ ] 描述：啟動順序邏輯與防呆機制的運作方式。
