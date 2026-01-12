#!/usr/bin/env python3
# 檔案用途：提供 iotVisionTurret YOLOv11 的訓練流程入口與權重輸出

# ───────────────────────────────────────────────
# 匯入區塊：集中管理訓練所需的標準函式庫
# ───────────────────────────────────────────────
import argparse
import importlib
import shutil
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# ───────────────────────────────────────────────
# 狀態資料結構區塊：定義訓練所需的核心設定
# ───────────────────────────────────────────────
@dataclass
class TrainConfig:
    """訓練設定資料結構。"""

    data: str
    model: str
    imgsz: int
    epochs: int
    batch: int
    device: str
    project: str
    name: str
    out_weights: str


# ───────────────────────────────────────────────
# 函式區塊用途：解析命令列參數
# ───────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    """解析訓練腳本參數。"""
    parser = argparse.ArgumentParser(description="iotVisionTurret YOLOv11 訓練腳本")
    # 參數說明區塊：訓練資料集設定檔或路徑
    parser.add_argument("--data", required=True, help="訓練資料集設定檔路徑")
    # 參數說明區塊：模型名稱或預訓練權重檔
    parser.add_argument("--model", required=True, help="模型名稱或預訓練權重檔")
    # 參數說明區塊：訓練影像大小
    parser.add_argument("--imgsz", type=int, default=640, help="訓練影像尺寸")
    # 參數說明區塊：訓練回合數
    parser.add_argument("--epochs", type=int, default=100, help="訓練回合數")
    # 參數說明區塊：訓練批次大小
    parser.add_argument("--batch", type=int, default=16, help="訓練批次大小")
    # 參數說明區塊：訓練裝置 (cpu/cuda)
    parser.add_argument("--device", default="cpu", help="訓練裝置 (cpu/cuda)")
    # 參數說明區塊：訓練輸出專案目錄
    parser.add_argument("--project", default="runs/train", help="訓練輸出專案目錄")
    # 參數說明區塊：訓練輸出名稱
    parser.add_argument("--name", default="exp", help="訓練輸出名稱")
    # 參數說明區塊：輸出 best.pt 目標路徑
    parser.add_argument("--out-weights", required=True, help="best.pt 複製輸出路徑")
    return parser.parse_args()


# ───────────────────────────────────────────────
# 函式區塊用途：將命令列參數轉換成訓練設定
# ───────────────────────────────────────────────
def build_config(args: argparse.Namespace) -> TrainConfig:
    """組裝訓練設定。"""
    return TrainConfig(
        data=args.data,
        model=args.model,
        imgsz=args.imgsz,
        epochs=args.epochs,
        batch=args.batch,
        device=args.device,
        project=args.project,
        name=args.name,
        out_weights=args.out_weights,
    )


# ───────────────────────────────────────────────
# 函式區塊用途：載入 ultralytics YOLO 類別
# ───────────────────────────────────────────────
def load_yolo_class():
    """延後載入 ultralytics YOLO，避免非訓練流程失敗。"""
    module = importlib.import_module("ultralytics")
    return module.YOLO


# ───────────────────────────────────────────────
# 函式區塊用途：推導 best.pt 的預期路徑
# ───────────────────────────────────────────────
def build_expected_best_path(config: TrainConfig, save_dir: Optional[Path]) -> Path:
    """根據訓練輸出目錄推導 best.pt 路徑。"""
    base_dir = save_dir if save_dir else Path(config.project) / config.name
    return base_dir / "weights" / "best.pt"


# ───────────────────────────────────────────────
# 函式區塊用途：執行訓練流程並回傳 best.pt 路徑
# ───────────────────────────────────────────────
def run_training(config: TrainConfig) -> Path:
    """執行訓練流程並回傳 best.pt 路徑。"""
    yolo_class = load_yolo_class()
    # 模型載入區塊用途：載入指定模型或權重
    model = yolo_class(config.model)
    # 訓練執行區塊用途：呼叫 ultralytics 訓練流程
    results = model.train(
        data=config.data,
        imgsz=config.imgsz,
        epochs=config.epochs,
        batch=config.batch,
        device=config.device,
        project=config.project,
        name=config.name,
    )
    save_dir = Path(getattr(results, "save_dir", "")) if results else None
    best_path = build_expected_best_path(config, save_dir if save_dir and str(save_dir) else None)
    return best_path


# ───────────────────────────────────────────────
# 函式區塊用途：主程式入口，負責串接參數與輸出
# ───────────────────────────────────────────────
def main() -> None:
    """主程式入口。"""
    args = parse_args()
    config = build_config(args)

    best_path: Optional[Path] = None
    error_message: Optional[str] = None
    copy_success = False

    try:
        # 訓練流程區塊用途：執行訓練並取得 best.pt 路徑
        best_path = run_training(config)
        if not best_path.is_file():
            # 錯誤分支區塊用途：找不到 best.pt 時回報清楚路徑
            raise FileNotFoundError(f"找不到 best.pt，預期位置：{best_path}")

        out_path = Path(config.out_weights)
        out_dir = out_path.parent
        # 目錄建立區塊用途：確保輸出目錄存在，避免複製失敗
        out_dir.mkdir(parents=True, exist_ok=True)
        # 檔案複製區塊用途：將 best.pt 複製至指定輸出路徑
        shutil.copy2(best_path, out_path)
        copy_success = True
    except Exception as exc:
        # 錯誤處理區塊用途：捕捉訓練或複製流程錯誤並記錄原因
        error_message = str(exc)
        sys.stderr.write(traceback.format_exc())
    finally:
        # 輸出資訊區塊用途：輸出訓練與複製結果供外部檢視
        display_best_path = best_path if best_path else build_expected_best_path(config, None)
        print(f"best.pt: {display_best_path}")
        print(f"copied_to: {config.out_weights}")
        if copy_success:
            print("copy_result: OK")
        else:
            failure_reason = error_message or "未知錯誤"
            print(f"copy_result: FAILED ({failure_reason})")

    if not copy_success:
        # 結束狀態區塊用途：複製失敗時回傳非零狀態碼
        sys.exit(1)


if __name__ == "__main__":
    # 函式區塊用途：提供 CLI 執行入口
    main()
