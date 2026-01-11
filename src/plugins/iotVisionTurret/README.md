<!-- 檔案用途：說明 iotVisionTurret 插件的 IoT 路由整合與裝置通訊流程 -->

# iotVisionTurret IoT 路由整合說明

## 概述

iotVisionTurret 插件透過主服務注入的 Express app 註冊 IoT 裝置通訊路由，**禁止自行 listen 或啟動新 Server**。主服務需建立唯一的 Express 實例，並在插件 `online()` 時注入至 `options.expressApp`。

## 路由與流程

### 1. 裝置註冊 `POST /iot/register`

- Content-Type：`application/json`
- Body 範例：

```json
{ "device_id": "turret-001" }
```

- **device_id 格式要求**：
  - 僅允許英數字、底線 (`_`)、連字號 (`-`)
  - 長度限制：1-64 字元
  - 範例：`turret-001`、`device_A`、`test-device-123`

- 回應成功：

```json
{
  "ok": true,
  "device_id": "turret-001",
  "pull_url": "/iot/pull",
  "upload_url": "/iot/upload"
}
```

- 錯誤回應範例：
  - `400`：`{ "ok": false, "message": "device_id 為必填欄位" }`
  - `400`：`{ "ok": false, "message": "device_id 僅允許英數字、底線、連字號，長度 1-64 字元" }`
  - `409`：`{ "ok": false, "message": "目前有上傳作業進行中，請稍後再試" }`
  - `415`：`{ "ok": false, "message": "必須使用 application/json" }`

註冊成功後會重置指令佇列與影像等待者，並將裝置狀態標記為上線。若有上傳作業進行中則拒絕註冊，避免狀態競態。

### 2. 指令拉取（長輪詢）`GET /iot/pull`

- 若有待送指令，立即回傳：

```json
{ "ok": true, "commands": [ ... ] }
```

- 若無指令，進入長輪詢，逾時 25 秒後回傳 `204 No Content`。

- 錯誤回應範例：
  - `409`：`{ "ok": false, "message": "裝置尚未註冊" }`

### 3. 影像上傳 `POST /iot/upload?image_id=...`

- 必填 query：`image_id`
- **image_id 格式要求**：
  - 僅允許英數字、底線 (`_`)、連字號 (`-`)
  - 長度限制：1-64 字元
  - 範例：`img001`、`capture_20240101`

- **支援上傳方式**（僅支援 binary body）：
  - `Content-Type: application/octet-stream`
  - `Content-Type: image/jpeg`、`image/png`、`image/*`
  
- **檔案大小限制**：20MB

- **不支援 multipart/form-data**，請使用 binary body 直接傳送影像內容

上傳完成後會固定儲存至：

```
artifacts/iotVisionTurret/<image_id>.jpg
```

並在記錄器中清楚標示 Content-Type 與儲存路徑。

- 回應成功：

```json
{ "ok": true }
```

- 錯誤回應範例：
  - `400`：`{ "ok": false, "message": "image_id 為必填 query 參數" }`
  - `400`：`{ "ok": false, "message": "image_id 僅允許英數字、底線、連字號，長度 1-64 字元" }`
  - `400`：`{ "ok": false, "message": "上傳內容不可為空" }`
  - `400`：`{ "ok": false, "message": "不支援的 Content-Type，僅支援 application/octet-stream 或 image/*" }`
  - `409`：`{ "ok": false, "message": "裝置尚未註冊" }`
  - `409`：`{ "ok": false, "message": "目前有其他上傳作業進行中" }`
  - `409`：`{ "ok": false, "message": "image_id 已存在，請使用新的 ID" }`
  - `500`：`{ "ok": false, "message": "<錯誤訊息>" }`

## 安全性與限制

- 所有 `device_id` 和 `image_id` 僅允許安全字元（英數字、`_`、`-`），防止路徑穿越攻擊
- 上傳檔案大小限制為 20MB
- 影像等待逾時預設為 30 秒（可透過 `send()` 的 `waitTimeoutMs` 參數調整）
- 長輪詢逾時固定為 25 秒
- 同一時間僅允許一個上傳作業，避免檔案寫入衝突

## 注意事項

- 插件僅負責註冊路由，所有 HTTP 入口由主服務統一管理。
- 若裝置未註冊即呼叫 `/iot/pull` 或 `/iot/upload`，會回傳 `409` 錯誤並記錄 log。
- 上傳的影像檔案統一以 `.jpg` 副檔名儲存，無論實際格式為何（未來可能改進）。

## 測試建議

建議針對以下場景進行整合測試：
- 裝置註冊流程（正常與錯誤格式）
- 長輪詢行為（有指令、無指令、逾時、連線中斷）
- 影像上傳（binary body、大小限制、重複 ID、併發上傳）
- 狀態管理（裝置重新註冊、離線清理）
