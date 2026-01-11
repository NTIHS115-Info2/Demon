# 未知領域的小惡魔（Demon AI Assistant）

一個模組化的 AI 女兒兼助手，支援多種功能。
本專案由 屑塵 設計與實作，旨在打造具備個性與語境理解能力的 AI 女兒

---

## 📖 目錄

- [最新資訊](#-最新資訊)
- [架構組成](#-架構組成)
- [目前已實作的 Plugins](#-目前已實作的-plugins)
- [使用技術與函式庫](#-使用技術與函式庫)
- [作者資訊](#-作者資訊)
- [注意事項](#-注意事項)

---

## 🆕最新資訊
- 2025/10/03 : 更新版本1.4

---

## 📐 架構組成

本專案採用 Plugin-based 架構，功能皆可模組化替換，以下為幾個重要的核心元件：

- **pluginsManage**
  - 負責插件的管理與啟動
  - 掃描並啟動 plugin
  - 根據環境與優先序動態選擇 strategy
  - 負責 plugin 註冊與生命周期管理

- **historyManage**
  - 管理對話歷史與上下文
  - 提供上下文查詢與更新功能

- **PromptComposer**
  - 負責管理並組合提示詞(工具/系統/對話)

- **TalkToDemon**
  - 負責處理與 Demon 進行對話的核心腳本

- **toolOutputRouter**
  - 負責解析 Demon 在對話中使用的工具

---

## 🔌 目前已實作的 Plugins

| Plugin 名稱         | 功能簡述                            | 版本 |
|----------------------|-------------------------------------|---|
| `ASR`   | 即時語音辨識，支援斷句與清理        ||
| `ttsEngine`   | 低階語音合成引擎，僅輸出音訊串流與相關 metadata（不播放、不存檔、不產生 URL） ||
| `ttsArtifact` | 預設語音入口，建立 artifact 並回傳 URL（engine → chunks → wav → metadata → url） ||
| `llamaServer`     | 語言模型推理 ||
| `discord`   | 對於discord的使用支持(discord bot)  ||
| `speechBroker`       | 負責文字轉語音的中間處理（預設使用 ttsArtifact） ||
| `toolReference(llmTool)` | 即時整理並提供工具描述（系統會自動產生摘要，LLM 需以 ToolName 查詢詳細內容）  |v0.5|
| `getTime(llmTool)` | 取得並偏移時間的工具 |v0.1.1|
| `diffTime(llmTool)` | 計算時間差距的工具 |v0.1.1|
| `weatherSystem(llmTool)` | 用來獲取天氣相關資訊的工具| v1.1|

> 所有插件皆透過統一介面實作，可自行擴充、替換或關閉。

### 🎙️ ttsEngine / ttsArtifact 使用說明

- **ttsArtifact（預設入口）**
  - **用途**：接收文字並建立可即時讀取的語音 artifact。
  - **輸入 / 輸出**：輸入文字，輸出 `{artifact_id, url, format, duration_ms}`。
  - **責任邊界**：負責 WAV 檔與 metadata 落地、回傳 URL。
  - **適用情境**：需要下載 URL、快取音檔、或讓外部服務透過 HTTP 存取。

- **ttsEngine（低階模式）**
  - **用途**：純語音合成引擎，只輸出音訊串流。
  - **輸入 / 輸出**：stdin JSONL（`text`/`end`）輸入；stdout frame protocol 輸出 PCM 音訊。
  - **責任邊界**：不播放、不存檔、不產生 URL。
  - **適用情境**：需要即時串流播放或自行處理音訊資料的整合方。

## 🧰目前已實作工具庫
| 工具名稱 | 工具簡述 | 版本 |
| --- | --- | ---|
| `jsonParser` | 將輸入的json檔案轉換成Object | v.0.1 |

---

## 🔧 使用技術與函式庫

| 技術／庫            | 用途                   | 授權       |
|----------------------|------------------------|------------|
| [`llama.cpp`](https://github.com/ggerganov/llama.cpp) | 本地語言模型推理引擎   | MIT        |
| [`Whisper`](https://github.com/openai/whisper) | 本地語音辨識            | MIT        |
| [`F5-TTS`](https://github.com/SWivid/F5-TTS) | 高品質語音合成系統      | MIT        |
| `Node.js` + `PythonShell` | 作為跨語言橋接         | MIT / 自製橋接層 |

---

## ✍️ 作者資訊

本專案由 屑塵 設計與開發。  
如果你覺得這個專案有趣，歡迎 fork、引用、或改編使用。

---

## 🚧 注意事項

- 本專案仍處於開發階段，部分功能尚未完全模組化
- 對話內容與角色設定屬於創作性作品，請勿未經同意直接套用於商業用途
