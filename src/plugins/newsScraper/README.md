# News Scraper 插件

## 插件簡介 (Introduction)
News Scraper 是一個專為 LLM 設計的「混合搜尋策略 (Hybrid Search Strategy)」新聞爬蟲插件，透過多來源協作與智慧調度，提供穩定、可擴充且具備高韌性的新聞搜尋與摘要能力。

### 核心特色
- **多源聚合**：整合 SearXNG（主力抗封鎖）、Google CSE（精準備援）、Tavily（AI 摘要）三大來源。
- **Bionic Dispatcher**：具備智慧調度與「軟性冷卻 (Soft Penalty)」機制，能自動規避 429 限流。
- **寬容解析 (Lenient Parsing)**：即使搜尋引擎回傳錯誤碼，只要包含有效數據即可提取。

## 核心架構 (Architecture)

### 資料流
Researcher（發起搜尋） → Scraper（爬取內容） → Librarian（向量過濾） → Summarizer（AI 摘要）

### 關鍵基礎設施
- **SearXNG 採用「Docker 映像檔燒錄 (Baked-in Config)」策略**：設定在建置階段燒錄進映像檔，以解決跨平台權限問題與設定檔覆寫風險。

## 環境前置需求 (Prerequisites)

### 必要環境
- **Docker & Docker Compose**：運行 SearXNG 必備。
- **Python 3.10+**
- **Node.js**（插件橋接層）

### 外部服務
- **Google Custom Search API Key & CX**（選填，推薦用於備援）
- **Tavily API Key**（選填，用於高品質摘要）

## 安裝與部署指南 (Deployment Guide)

> 以下步驟可完整重現環境，請依序執行。

### Step 1: Python 依賴安裝
```bash
pip install -r src/plugins/newsScraper/requirements.txt
```

### Step 2: 設定檔初始化
1. 複製設定檔：
```bash
cp src/plugins/newsScraper/setting.json src/plugins/newsScraper/setting.local.json
```

2. 編輯 `setting.local.json`，欄位說明如下：
- `search_priority`：搜尋順序（如 `searxng`、`google`、`tavily` 的優先順序）。
- `searxng_base_url`：SearXNG 服務位址，預設為 `http://localhost:8080/`。
- `google_api_key`：Google Custom Search API Key（選填）。
- `google_cse_id`：Google Custom Search Engine ID (CX)，使用 Google 搜尋時必填。
- `tavily_api_key`：Tavily API Key（選填）。

### Step 3: SearXNG 服務啟動 (Critical)
> **重要**：本專案使用自定義 Dockerfile 來固化設定，**不能**直接使用官方 Image。

```bash
cd src/plugins/newsScraper/searxng
# 務必使用 --build 以確保 settings.yml 被正確燒錄進映像檔
docker-compose up -d --build
```

驗證方式：開啟瀏覽器訪問 `http://localhost:8080`，確認服務已上線。

## 測試與使用 (Usage)

### CLI 單元測試指令
```bash
python3 -m src.plugins.newsScraper.strategies.local.researcher '{"topic": "AI", "query": "Latest LLM developments", "detail_level": "normal"}'
```

## 故障排除 (Troubleshooting)

### SearXNG 報錯 429 Too Many Requests
- 這是上游引擎（如 Google）的限制。
- 系統會自動觸發冷卻，**無需人工介入**，請勿頻繁重啟容器。

### SearXNG 啟動失敗或設定未生效
- 請執行以下指令強制重建映像檔：
```bash
docker-compose build --no-cache
```
