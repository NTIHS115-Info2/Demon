# App Voice Message Service

## POST /app/voice/message

### 使用範例（curl）
```bash
curl -X POST "http://localhost:3000/app/voice/message" \
  -H "X-App-Client: ios" \
  -F "file=@./sample.m4a" \
  -F "username=app"
```

### Header 說明（F1 / F2 / F3）
- **F1：`X-Trace-Id`**
  - 伺服器產生的追蹤編號，方便 App 端追查單次請求。
- **F2：`X-Turn-Id`**
  - 單次對話回合識別碼，用於關聯後續紀錄。
- **F3：流程耗時標頭**
  - `X-ASR-Duration-Ms` / `X-LLM-Duration-Ms` / `X-TTS-Duration-Ms` / `X-Transcode-Duration-Ms`
  - 各階段耗時（毫秒），用於效能監控與排查。

### 回傳行為
- **成功**：
  - `Content-Type: audio/m4a`
  - 直接回傳 m4a 音訊串流。
  - 會設定 `Access-Control-Expose-Headers` 讓 App 可讀取 `X-*` 標頭。
- **失敗**：
  - `Content-Type: application/json`
  - 回傳格式：
    ```json
    {
      "trace_id": "...",
      "error": {
        "code": "...",
        "message": "...",
        "details": "..."
      }
    }
    ```

## GET /app/voice/health

### 說明
- 健康檢查用路由，只回傳服務狀態，不會觸發任何語音流程。
