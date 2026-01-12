<!-- 檔案用途：說明 iotVisionTurret 的 YOLOv11 本地模型流程與目錄結構 -->

<!-- 文件總覽段落用途：交代此 README 的閱讀目的 -->
# iotVisionTurret YOLOv11 本地策略說明

<!-- 狀態資料結構區塊用途：描述訓練與推論所需的設定資料 -->
## 狀態資料結構
<!-- 狀態資料結構內容段落用途：列出訓練與推論的主要狀態欄位 -->
- `config`: 訓練與推論所需的模型設定（例如模型權重、資料集路徑、輸出目錄）
- `runtime`: 執行期間的環境資訊（例如裝置、批次大小、執行時間）
- `result`: 訓練或推論結果摘要（例如 mAP、辨識框資訊）

<!-- 腳本介面區塊用途：描述 train 與 infer 腳本對外介面 -->
## 腳本介面
<!-- 腳本介面內容段落用途：說明訓練與推論腳本的責任 -->
- `train.py`: 負責本地訓練流程，預期接收 JSON 參數或 CLI 參數
- `infer.py`: 負責本地推論流程，預期接收 JSON 參數或 CLI 參數

<!-- 權重檔案區塊用途：描述 weights 目錄用途 -->
## 權重檔案
<!-- 權重檔案內容段落用途：說明權重檔案的預期存放位置 -->
- `weights/`: 存放訓練或下載的模型權重（目前留空）

<!-- 資料集結構區塊用途：說明 YOLOv11 訓練資料夾的預期格式 -->
## 資料集結構
<!-- 資料集結構內容段落用途：提供標準資料夾層級範例 -->
```
Dataset/
├─ images/
│  ├─ train/
│  ├─ val/
│  └─ test/
└─ labels/
   ├─ train/
   ├─ val/
   └─ test/
```

<!-- 標註格式區塊用途：說明 YOLO 標籤檔案格式 -->
## Label 格式
<!-- 標註格式內容段落用途：描述每個標註檔案的欄位定義 -->
- 每張影像對應一個 `.txt` 標註檔，檔名需與影像一致。
- 每行格式：`class_id x_center y_center width height`，座標以影像寬高正規化至 0~1。

<!-- data.yaml 範例區塊用途：提供資料集設定檔參考樣板 -->
## data.yaml 範例
<!-- data.yaml 範例內容段落用途：示範資料集路徑與類別名稱設定 -->
```yaml
path: /absolute/path/to/Dataset
train: images/train
val: images/val
names:
  0: person
  1: helmet
```

<!-- 依賴安裝區塊用途：說明 requirements 的安裝方式 -->
## Requirements 安裝
<!-- 依賴安裝內容段落用途：提供依 repo 慣例的安裝指令 -->
```bash
python -m pip install -r src/plugins/iotVisionTurret/strategies/local/YOLOv11/requirements.txt
```

<!-- 訓練指令區塊用途：提供 CPU/GPU 兩種訓練範例 -->
## 訓練指令
<!-- 訓練指令內容段落用途：示範 CPU 訓練指令 -->
```bash
python src/plugins/iotVisionTurret/strategies/local/YOLOv11/train.py \
  --data /absolute/path/to/data.yaml \
  --model yolov11n.pt \
  --imgsz 640 \
  --epochs 100 \
  --batch 16 \
  --device cpu \
  --project runs/train \
  --name exp \
  --out-weights src/plugins/iotVisionTurret/strategies/local/YOLOv11/weights/best.pt
```
<!-- 訓練指令內容段落用途：示範 GPU 訓練指令 -->
```bash
python src/plugins/iotVisionTurret/strategies/local/YOLOv11/train.py \
  --data /absolute/path/to/data.yaml \
  --model yolov11n.pt \
  --imgsz 640 \
  --epochs 100 \
  --batch 16 \
  --device cuda \
  --project runs/train \
  --name exp \
  --out-weights src/plugins/iotVisionTurret/strategies/local/YOLOv11/weights/best.pt
```

<!-- best.pt 位置區塊用途：說明訓練輸出與複製的權重位置 -->
## best.pt 位置與用途
<!-- best.pt 位置內容段落用途：說明訓練輸出與推論使用方式 -->
- 訓練完成後，ultralytics 會在 `runs/train/exp/weights/best.pt` 產生最佳權重。
- `train.py` 會將該權重複製到 `YOLOv11/weights/best.pt`，供後續推論與部署使用。

<!-- index.py 推論測試區塊用途：說明如何以 stdin JSON 執行推論 -->
## index.py 推論測試方式
<!-- index.py 推論測試內容段落用途：提供 stdin JSON 範例 -->
```bash
echo '{"op":"infer","image_path":"/absolute/path/to/image.jpg","weights_path":"/absolute/path/to/best.pt","conf":0.5,"target":"person"}' \
  | python src/plugins/iotVisionTurret/strategies/local/index.py
```
<!-- index.py 推論測試補充段落用途：補充必要欄位與注意事項 -->
- 必填欄位：`image_path`、`weights_path`、`conf`；`target` 為選填。
- 需確保路徑為絕對路徑或相對於執行目錄的正確位置。

<!-- 常見錯誤排除區塊用途：列出常見問題與對應解法 -->
## 常見錯誤排除
<!-- 常見錯誤排除內容段落用途：提供排除權重不存在的方式 -->
- **權重不存在**：確認 `weights_path` 是否存在，必要時先執行訓練或手動下載權重。
<!-- 常見錯誤排除內容段落用途：提供排除路徑錯誤的方式 -->
- **路徑錯誤**：確認 `image_path` 或 `data.yaml` 的路徑正確，建議使用絕對路徑。
<!-- 常見錯誤排除內容段落用途：提供排除依賴缺失的方式 -->
- **依賴缺失**：重新執行 `pip install -r requirements.txt`，並確認 Python 版本符合需求。
