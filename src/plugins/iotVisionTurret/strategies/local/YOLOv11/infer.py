#!/usr/bin/env python3
# 檔案用途：提供 iotVisionTurret YOLOv11 的推論流程入口與推論函式封裝

# ───────────────────────────────────────────────
# 匯入區塊：集中管理推論所需的標準函式庫
# ───────────────────────────────────────────────
import argparse
import json
import sys
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple

# ───────────────────────────────────────────────
# 狀態資料結構區塊：定義推論所需的核心設定與結果格式
# ───────────────────────────────────────────────
@dataclass
class InferConfig:
    """推論設定資料結構。"""

    source: str
    weights: str
    conf_threshold: float
    device: str
    target: Optional[str]


@dataclass
class InferResult:
    """推論結果資料結構。"""

    ok: bool
    message: str
    detections: List[Dict[str, Any]]
    metadata: Dict[str, Any]


# ───────────────────────────────────────────────
# 函式區塊用途：解析命令列參數
# ───────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    """解析推論腳本參數。"""
    parser = argparse.ArgumentParser(description="iotVisionTurret YOLOv11 推論腳本")
    parser.add_argument("--source", required=True, help="輸入影像或影片來源")
    parser.add_argument("--weights", default="./weights/best.pt", help="模型權重檔案")
    parser.add_argument("--conf", type=float, default=0.25, help="信心門檻")
    parser.add_argument("--device", default="cpu", help="推論裝置 (cpu/cuda)")
    parser.add_argument("--target", default="", help="要追蹤的目標類別名稱")
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
        device=args.device,
        target=args.target if args.target else None,
    )


# ───────────────────────────────────────────────
# 函式區塊用途：計算邊界框與中心點資訊
# ───────────────────────────────────────────────
def build_bbox_and_center(x1: float, y1: float, x2: float, y2: float) -> Tuple[Dict[str, float], Dict[str, float]]:
    """根據座標建立 bbox 與中心點。"""
    width = max(0.0, x2 - x1)
    height = max(0.0, y2 - y1)
    center_x = x1 + width / 2.0
    center_y = y1 + height / 2.0
    bbox = {
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "width": width,
        "height": height,
    }
    center = {
        "x": center_x,
        "y": center_y,
    }
    return bbox, center


# ───────────────────────────────────────────────
# 函式區塊用途：將 YOLO 結果轉換成通用 detection 清單
# ───────────────────────────────────────────────
def extract_detections(result: Any, names: Dict[int, str]) -> List[Dict[str, Any]]:
    """抽取推論結果中的 detection 資訊。"""
    detections: List[Dict[str, Any]] = []
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return detections

    for box in boxes:
        cls_value = box.cls[0] if hasattr(box.cls, "__len__") else box.cls
        conf_value = box.conf[0] if hasattr(box.conf, "__len__") else box.conf
        xyxy_value = box.xyxy[0] if hasattr(box.xyxy, "__len__") else box.xyxy
        cls_id = int(cls_value)
        confidence = float(conf_value)
        x1, y1, x2, y2 = [float(v) for v in xyxy_value.tolist()]
        label = names.get(cls_id, str(cls_id))
        bbox, center = build_bbox_and_center(x1, y1, x2, y2)
        detections.append(
            {
                "label": label,
                "class_id": cls_id,
                "confidence": confidence,
                "bbox": bbox,
                "center": center,
            }
        )
    return detections


# ───────────────────────────────────────────────
# 函式區塊用途：執行 YOLOv11 推論並輸出統一格式
# ───────────────────────────────────────────────
def infer(
    image_path: str,
    weights_path: str,
    target: Optional[str],
    conf: float,
    device: str = "cpu",
) -> Dict[str, Any]:
    """執行 YOLOv11 推論並回傳結果。"""
    # 匯入區塊用途：延後載入 ultralytics，避免 CLI 不需要推論時就失敗
    from ultralytics import YOLO

    # 基本驗證區塊用途：確保信心值合理，避免模型推論異常
    conf_value = float(conf)
    if conf_value < 0.0 or conf_value > 1.0:
        raise ValueError("conf 必須介於 0 到 1 之間")

    # 推論模型建構區塊用途：載入權重並執行推論
    model = YOLO(weights_path)
    results = model.predict(source=image_path, conf=conf_value, device=device)
    if not results:
        raise RuntimeError("推論沒有回傳任何結果")

    # 結果整理區塊用途：擷取第一張影像的結果並建立統一結構
    primary = results[0]
    orig_shape = getattr(primary, "orig_shape", None)
    if not orig_shape or len(orig_shape) < 2:
        image_size = None
    else:
        image_size = {
            "width": int(orig_shape[1]),
            "height": int(orig_shape[0]),
        }

    # 類別名稱整理區塊用途：確保 names 為 dict 格式以便查詢
    raw_names = getattr(primary, "names", None) or getattr(model, "names", {})
    if isinstance(raw_names, list):
        names = {index: name for index, name in enumerate(raw_names)}
    else:
        names = raw_names

    detections = extract_detections(primary, names)

    # 目標比對區塊用途：挑選最符合目標的 detection
    matched = (
        [item for item in detections if item.get("label") == target]
        if target
        else detections
    )
    best = max(matched, key=lambda item: item.get("confidence", 0.0), default=None)
    found = best is not None

    # 組裝結果區塊用途：提供推論摘要與必要欄位
    return {
        "ok": True,
        "found": found,
        "target": target,
        "confidence": best.get("confidence") if found else 0.0,
        "center": best.get("center") if found else None,
        "bbox": best.get("bbox") if found else None,
        "image_size": image_size,
        "detections": detections,
        "metadata": {
            "image_path": image_path,
            "weights_path": weights_path,
            "conf": conf_value,
            "device": device,
            "total_detections": len(detections),
            "matched_detections": len(matched),
        },
    }


# ───────────────────────────────────────────────
# 函式區塊用途：執行推論流程（CLI 入口使用）
# ───────────────────────────────────────────────
def run_inference(config: InferConfig) -> InferResult:
    """執行推論流程並回傳結果。"""
    result = infer(
        image_path=config.source,
        weights_path=config.weights,
        target=config.target,
        conf=config.conf_threshold,
        device=config.device,
    )
    return InferResult(
        ok=result.get("ok", False),
        message="推論完成",
        detections=result.get("detections", []),
        metadata=result,
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
        sys.stdout.write(json.dumps(asdict(result), ensure_ascii=False))
    except Exception as exc:
        error_response = {
            "ok": False,
            "message": f"推論流程發生錯誤: {exc}",
            "detections": [],
            "metadata": {},
        }
        sys.stderr.write(json.dumps(error_response, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    # 函式區塊用途：提供 CLI 執行入口
    main()
