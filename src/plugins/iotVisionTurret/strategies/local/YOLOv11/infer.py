#!/usr/bin/env python3
# 檔案用途：提供 iotVisionTurret YOLOv11 的推論流程入口（設計骨架）

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from typing import Any, Dict, List

# 狀態資料結構區塊：定義推論所需的核心設定與結果格式
@dataclass
class InferConfig:
    """推論設定資料結構。"""

    source: str
    weights: str
    conf_threshold: float
    device: str


@dataclass
class InferResult:
    """推論結果資料結構。"""

    ok: bool
    message: str
    detections: List[Dict[str, Any]]
    metadata: Dict[str, Any]


# 函式區塊用途：解析命令列參數
def parse_args() -> argparse.Namespace:
    """解析推論腳本參數。"""
    parser = argparse.ArgumentParser(description="iotVisionTurret YOLOv11 推論腳本")
    parser.add_argument("--source", required=True, help="輸入影像或影片來源")
    parser.add_argument("--weights", default="./weights/best.pt", help="模型權重檔案")
    parser.add_argument("--conf", type=float, default=0.25, help="信心門檻")
    parser.add_argument("--device", default="cpu", help="推論裝置 (cpu/cuda)")
    return parser.parse_args()


# 函式區塊用途：將命令列參數轉換成推論設定
def build_config(args: argparse.Namespace) -> InferConfig:
    """組裝推論設定。"""
    return InferConfig(
        source=args.source,
        weights=args.weights,
        conf_threshold=args.conf,
        device=args.device,
    )


# 函式區塊用途：執行推論流程（目前為骨架設計）
def run_inference(config: InferConfig) -> InferResult:
    """執行推論流程並回傳結果。"""
    # TODO: 未來整合 ultralytics YOLOv11 推論流程
    return InferResult(
        ok=True,
        message="推論流程骨架已就緒，尚未啟用實際推論",
        detections=[],
        metadata={
            "source": config.source,
            "weights": config.weights,
            "conf_threshold": config.conf_threshold,
            "device": config.device,
        },
    )


# 函式區塊用途：主程式入口，負責串接參數與輸出
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
        sys.stdout.write(json.dumps(error_response, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    # 函式區塊用途：提供 CLI 執行入口
    main()
