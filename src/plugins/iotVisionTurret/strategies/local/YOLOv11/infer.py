#!/usr/bin/env python3
# 檔案用途：提供 iotVisionTurret YOLOv11 的推論流程入口與推論函式封裝

# ───────────────────────────────────────────────
# 匯入區塊：集中管理推論所需的標準函式庫
# ───────────────────────────────────────────────
import argparse
import importlib
import json
import os
import sys
import traceback
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

# ───────────────────────────────────────────────
# 狀態資料結構區塊：定義推論所需的核心設定
# ───────────────────────────────────────────────
@dataclass
class InferConfig:
    """推論設定資料結構。"""

    source: str
    weights: str
    conf_threshold: float
    target: str
    device: str


# ───────────────────────────────────────────────
# 函式區塊用途：解析命令列參數
# ───────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    """解析推論腳本參數。"""
    parser = argparse.ArgumentParser(description="iotVisionTurret YOLOv11 推論腳本")
    # 參數說明區塊：指定輸入影像路徑
    parser.add_argument("--source", required=True, help="輸入影像路徑")
    # 參數說明區塊：指定模型權重檔案
    parser.add_argument("--weights", required=True, help="模型權重檔案")
    # 參數說明區塊：指定信心門檻（conf_threshold）
    parser.add_argument("--conf", type=float, default=0.25, help="信心門檻")
    # 參數說明區塊：指定推論裝置 (cpu/cuda)
    parser.add_argument("--device", default="cpu", help="推論裝置 (cpu/cuda)")
    # 參數說明區塊：指定要追蹤的目標類別名稱
    parser.add_argument("--target", required=True, help="要追蹤的目標類別名稱")
    return parser.parse_args()


# ───────────────────────────────────────────────
# 函式區塊用途：將命令列參數轉換成推論設定
# ───────────────────────────────────────────────
def build_config(args: argparse.Namespace) -> InferConfig:
    """組裝推論設定。"""
    return InferConfig(
        source=args.source,
        weights=args.weights,
        conf_threshold=args.conf,
        target=args.target,
        device=args.device,
    )


# ───────────────────────────────────────────────
# 函式區塊用途：載入 ultralytics YOLO 類別
# ───────────────────────────────────────────────
def load_yolo_class():
    """延後載入 ultralytics YOLO，避免 CLI 匯入時即失敗。"""
    module = importlib.import_module("ultralytics")
    return module.YOLO


# ───────────────────────────────────────────────
# 函式區塊用途：載入 OpenCV 取得影像大小
# ───────────────────────────────────────────────
def load_image_size(image_path: str) -> Tuple[int, int]:
    """讀取影像尺寸，回傳 (w, h)。"""
    # 影像讀取區塊用途：使用 OpenCV 確保取得原始尺寸
    cv2 = importlib.import_module("cv2")
    image = cv2.imread(image_path)
    if image is None:
        # 錯誤分支區塊用途：影像讀取失敗時拋出例外給上層統一處理
        raise ValueError("影像讀取失敗，請確認影像格式或路徑")
    height, width = image.shape[:2]
    return int(width), int(height)


# ───────────────────────────────────────────────
# 函式區塊用途：截斷錯誤訊息避免回傳過長
# ───────────────────────────────────────────────
def trim_error_detail(message: str, limit: int = 200) -> str:
    """截斷錯誤訊息內容，避免 detail 過長。"""
    if len(message) <= limit:
        return message
    return message[:limit] + "..."


# ───────────────────────────────────────────────
# 函式區塊用途：計算邊界框與中心點資訊
# ───────────────────────────────────────────────
def build_bbox_and_center(x1: float, y1: float, x2: float, y2: float) -> Tuple[Dict[str, int], Dict[str, int]]:
    """根據座標建立 bbox 與中心點，並將結果轉為整數。"""
    # 座標整理區塊用途：確保 bbox 邏輯一致且為整數
    x1_int = int(round(x1))
    y1_int = int(round(y1))
    x2_int = int(round(x2))
    y2_int = int(round(y2))
    center_x = int(round((x1_int + x2_int) / 2))
    center_y = int(round((y1_int + y2_int) / 2))
    bbox = {
        "x1": x1_int,
        "y1": y1_int,
        "x2": x2_int,
        "y2": y2_int,
    }
    center = {
        "x": center_x,
        "y": center_y,
    }
    return bbox, center


# ───────────────────────────────────────────────
# 函式區塊用途：從 YOLO 結果抽取候選 detection
# ───────────────────────────────────────────────
def extract_candidates(
    boxes: Any,
    names: Dict[int, str],
    target: str,
    conf_threshold: float,
) -> List[Dict[str, Any]]:
    """抽取符合目標與信心門檻的候選框。"""
    candidates: List[Dict[str, Any]] = []
    for box in boxes:
        # 解析輸出區塊用途：兼容不同 tensor 型別的取值方式
        cls_value = box.cls[0] if hasattr(box.cls, "__len__") else box.cls
        conf_value = box.conf[0] if hasattr(box.conf, "__len__") else box.conf
        xyxy_value = box.xyxy[0] if hasattr(box.xyxy, "__len__") else box.xyxy
        cls_id = int(cls_value)
        confidence = float(conf_value)
        label = names.get(cls_id, str(cls_id))
        # 篩選判斷區塊用途：只保留 label 相符且信心值達標的框
        if label != target or confidence < conf_threshold:
            continue
        x1, y1, x2, y2 = [float(value) for value in xyxy_value.tolist()]
        bbox, center = build_bbox_and_center(x1, y1, x2, y2)
        candidates.append(
            {
                "label": label,
                "conf": confidence,
                "bbox": bbox,
                "center": center,
            }
        )
    return candidates


# ───────────────────────────────────────────────
# 函式區塊用途：執行 YOLOv11 推論並輸出統一格式
# ───────────────────────────────────────────────
def infer(image_path, weights_path, target, conf=0.25, device="cpu"):
    """執行 YOLOv11 推論並回傳指定格式結果。"""
    # 基本檢查區塊用途：確認權重檔案存在
    if not os.path.isfile(weights_path):
        return {"ok": False, "error": "WEIGHTS_NOT_FOUND"}
    # 基本檢查區塊用途：確認影像檔案存在
    if not os.path.isfile(image_path):
        # 設計說明區塊用途：將影像缺失視為獨立錯誤碼，便於外部快速判斷
        return {"ok": False, "error": "IMAGE_NOT_FOUND"}
    # 基本檢查區塊用途：確認 target 不為空字串
    if not isinstance(target, str) or not target.strip():
        return {"ok": False, "error": "INFER_FAILED", "detail": "target 不可為空"}

    # 影像尺寸讀取區塊用途：先取得影像尺寸供成功或未命中時回傳
    try:
        image_width, image_height = load_image_size(image_path)
    except Exception as exc:
        # 錯誤分支區塊用途：影像讀取失敗時轉換為 INFER_FAILED
        sys.stderr.write(traceback.format_exc())
        return {"ok": False, "error": "INFER_FAILED", "detail": trim_error_detail(str(exc))}

    # 推論區塊用途：包住 YOLO 推論流程，統一錯誤處理
    try:
        yolo_class = load_yolo_class()
        # 模型載入區塊用途：載入指定權重
        model = yolo_class(weights_path)
        # 推論執行區塊用途：啟動 YOLO 推論流程
        results = model.predict(source=image_path, conf=float(conf), device=device)
        if not results:
            # 錯誤分支區塊用途：推論沒有回傳結果時直接中止
            raise RuntimeError("推論結果為空")

        primary = results[0]
        boxes = getattr(primary, "boxes", None)
        raw_names = getattr(primary, "names", None) or getattr(model, "names", None)
        if boxes is None or raw_names is None:
            # 錯誤分支區塊用途：結果格式不完整時回報錯誤
            raise RuntimeError("推論結果格式異常")

        # 類別名稱整理區塊用途：確保 names 為 dict 格式以便查詢
        if isinstance(raw_names, list):
            names = {index: name for index, name in enumerate(raw_names)}
        elif isinstance(raw_names, dict):
            names = raw_names
        else:
            # 錯誤分支區塊用途：類別名稱型別異常時回報
            raise RuntimeError("類別名稱格式異常")

        candidates = extract_candidates(boxes, names, target, float(conf))
        if not candidates:
            # 未命中回傳區塊用途：推論成功但沒有符合目標時回傳 found=false
            return {
                "ok": True,
                "found": False,
                "image_size": {"w": image_width, "h": image_height},
            }

        # 最佳結果選擇區塊用途：採用最高信心值避免追蹤抖動
        best = max(candidates, key=lambda item: item.get("conf", 0.0))
        return {
            "ok": True,
            "found": True,
            "image_size": {"w": image_width, "h": image_height},
            "label": best["label"],
            "conf": best["conf"],
            "bbox": best["bbox"],
            "center": best["center"],
        }
    except Exception as exc:
        # 錯誤處理區塊用途：統一回傳 INFER_FAILED 並保留錯誤訊息
        sys.stderr.write(traceback.format_exc())
        return {"ok": False, "error": "INFER_FAILED", "detail": trim_error_detail(str(exc))}


# ───────────────────────────────────────────────
# 函式區塊用途：執行推論流程（CLI 入口使用）
# ───────────────────────────────────────────────
def run_inference(config: InferConfig) -> Dict[str, Any]:
    """執行推論流程並回傳結果。"""
    return infer(
        image_path=config.source,
        weights_path=config.weights,
        target=config.target,
        conf=config.conf_threshold,
        device=config.device,
    )


# ───────────────────────────────────────────────
# 函式區塊用途：主程式入口，負責串接參數與輸出
# ───────────────────────────────────────────────
def main() -> None:
    """主程式入口。"""
    try:
        args = parse_args()
        config = build_config(args)
        result = run_inference(config)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        # 錯誤處理區塊用途：捕捉非預期例外並避免輸出非 JSON 格式
        sys.stderr.write(traceback.format_exc())
        error_response = {
            "ok": False,
            "error": "INFER_FAILED",
            "detail": trim_error_detail(str(exc)),
        }
        sys.stdout.write(json.dumps(error_response, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    # 函式區塊用途：提供 CLI 執行入口
    main()
