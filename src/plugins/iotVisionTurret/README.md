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

- 回應：

```json
{
  "ok": true,
  "device_id": "turret-001",
  "pull_url": "/iot/pull",
  "upload_url": "/iot/upload"
}
```

註冊成功後會重置指令佇列與影像等待者，並將裝置狀態標記為上線。

### 2. 指令拉取（長輪詢）`GET /iot/pull`

- 若有待送指令，立即回傳：

```json
{ "ok": true, "commands": [ ... ] }
```

- 若無指令，進入長輪詢，逾時 25 秒後回傳 `204 No Content`。

### 3. 影像上傳 `POST /iot/upload?image_id=...`

- 必填 query：`image_id`
- 支援上傳方式：
  - **Binary body**：`application/octet-stream` 或 `image/*`
  - **multipart/form-data**：需包含一個檔案欄位（取第一個檔案）

上傳完成後會固定儲存至：

```
artifacts/iotVisionTurret/<image_id>.jpg
```

並在記錄器中清楚標示 Content-Type 與儲存路徑。

## 注意事項

- 插件僅負責註冊路由，所有 HTTP 入口由主服務統一管理。
- 若裝置未註冊即呼叫 `/iot/pull` 或 `/iot/upload`，會回傳錯誤並記錄 log。
