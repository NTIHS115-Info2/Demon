# ttsEngine / ttsArtifact 更新紀錄（2026-01-11）

## 變更摘要

- `tts` 正式調整為 `ttsEngine`，職責聚焦為語音合成引擎：**不播放、不存檔，只輸出音訊串流**。
- 新增 `ttsArtifact` 作為預設入口，負責承接 `ttsEngine` 的音訊輸出並建立 artifact 管線：**engine → chunks → wav → metadata → url**。
- 明確定義增量輸入與音訊輸出協議：stdin JSONL 事件（`text`/`end`）與 stdout frame protocol（長度前綴 + JSON header + payload）。
- 對外公開 URL 由 `ttsArtifact` 提供，預設路由為 `GET /media/:artifact_id/file`，並可透過公開 base URL 對外曝光。

## Breaking changes

- 無

## 遷移指南（Migration）

- **全域搜尋替換建議**：
  - 將 `tts` 全域替換為 `ttsEngine`，並檢查對應 plugin 設定與呼叫點。
  - 新增或改用 `ttsArtifact` 作為主要入口，並將原本期待「直接拿 URL」的流程移至 `ttsArtifact`。
- **責任邊界調整**：
  - `ttsEngine` 僅輸出音訊串流與 metadata（例如 `format`、`sample_rate`、`channels`）。
  - `ttsArtifact` 負責將串流轉成 WAV、落地 metadata、建立 URL。

## 使用方式 / 範例

### 1) 預設入口：呼叫 `ttsArtifact` 取得 artifact 資訊

```json
// 呼叫 ttsArtifact（輸入）
{
  "text": "今天的天氣很適合散步。"
}
```

```json
// 回傳（輸出）
{
  "artifact_id": "01J7ZQ7K9KJ9Q6Z3M2Q4G7D8QH",
  "url": "http://localhost:3200/media/01J7ZQ7K9KJ9Q6Z3M2Q4G7D8QH/file",
  "format": "wav",
  "duration_ms": 1480
}
```

> 取得 `url` 後即可透過 `GET /media/:artifact_id/file` 讀取 WAV 音檔，對外可搭配公開 base URL 設定。

### 2) 低階模式：直接呼叫 `ttsEngine`（僅音訊輸出，不產生 URL）

- **stdin JSONL（增量輸入）**：
  - `{"type":"text","session_id":"<id>","text":"..."}` 可多次追加。
  - `{"type":"end","session_id":"<id>"}` 表示結束輸入並開始合成。
- **stdout frame protocol（增量輸出）**：
  - 每個 frame 先輸出 4-byte big-endian 長度，再輸出 JSON header。
  - `type=start`：回傳 `format`、`sample_rate`、`channels`。
  - `type=audio`：回傳 `seq`、`payload_bytes`，隨後接上 PCM payload。
  - `type=done`：結束訊號；`type=error`：錯誤資訊。

> 此模式適合需要即時串流播放或自行處理音訊資料的整合方，但不會建立 artifact 或 URL。
