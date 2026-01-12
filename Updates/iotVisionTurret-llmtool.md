<!-- 檔案用途：記錄 iotVisionTurret 插件的版本更新資訊 -->

#### iotVisionTurret 插件更新紀錄

### [v0.8]
#### Fix
- 調整 infer() 改為顯式傳入裝置參數並補上 IMAGE_NOT_FOUND 設計說明

### [v0.7]
#### New
- 補齊 YOLOv11 依賴清單，改用 headless OpenCV 以符合無 GUI 環境
- 完成 YOLOv11 推論封裝與錯誤代碼回傳，並補上目標篩選與最佳框選擇邏輯
- 實作 YOLOv11 訓練 CLI 與 best.pt 複製輸出流程，輸出訓練結束資訊

### [v0.6]
#### Fix
- 修正 Python runner stdout 統一單行 JSON 且補上換行結尾，錯誤輸出維持固定格式

### [v0.5]
#### New
- 新增本地策略 Python runner 的 stdin JSON 解析與 YOLOv11 推論封裝，統一 stdout 單行 JSON 格式與錯誤處理

### [v0.4]
#### New
- 新增 runYoloInfer 橋接流程，改以 stdin/stdout JSON 協議呼叫 Python YOLO 推理並補齊逾時與錯誤處理

### [v0.3]
#### New
- 新增 iotVisionTurret 工具入口 send(data) 的掃描、追蹤與 IR 發送流程，並加入全域逾時與上傳逾時控制
- 補齊掃描/追蹤各階段錯誤處理與紀錄，確保僅回傳固定格式結果

### [v0.2]
#### New
- 新增 IoT 裝置通訊路由（註冊、長輪詢拉取、影像上傳）並導入 Express app 注入機制
- 加入模組層級裝置狀態與影像等待者管理流程，補齊長輪詢與上傳錯誤處理
- 補充 iotVisionTurret README，說明裝置註冊、拉取與影像上傳流程

### [v0.1]
#### New
- 新增 iotVisionTurret 插件骨架，包含本地策略與 YOLOv11 目錄結構
- 建立本地策略 Node.js 介面與 Python runner stub
- 補齊訓練與推論腳本設計骨架及依賴清單
