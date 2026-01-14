#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 檔案用途：提供 iotVisionTurret 本地策略的 Python runner 入口（stdin/stdout JSON 協議）

# ───────────────────────────────────────────────
# 匯入區塊：集中管理標準函式庫與推論模組
# ───────────────────────────────────────────────
import json
import os
import sys
import traceback
from typing import Any, Dict, Tuple

# 確保在 Windows 環境下使用 UTF-8 編碼輸出
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

from YOLOv11.infer import infer

# ───────────────────────────────────────────────
# 常數區塊：定義錯誤代碼與必要欄位清單
# ───────────────────────────────────────────────
REQUIRED_FIELDS = ("image_path", "weights_path", "conf")


# ───────────────────────────────────────────────
# 自訂錯誤類別區塊：統一錯誤格式與代碼
# ───────────────────────────────────────────────
class RunnerError(Exception):
    """Runner 專用錯誤，包含代碼與可讀訊息。"""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


# ───────────────────────────────────────────────
# 輔助函式區塊：輸出 stdout JSON（單行且以換行結束）
# ───────────────────────────────────────────────
def emit_stdout(payload: Dict[str, Any]) -> None:
    """輸出單行 JSON 到 stdout。"""
    sys.stdout.write(f"{json.dumps(payload, ensure_ascii=False)}\n")
    sys.stdout.flush()


# ───────────────────────────────────────────────
# 輔助函式區塊：輸出 stderr 訊息（允許 debug/traceback）
# ───────────────────────────────────────────────
def emit_stderr(message: str) -> None:
    """輸出訊息到 stderr。"""
    sys.stderr.write(message)
    if not message.endswith("\n"):
        sys.stderr.write("\n")
    sys.stderr.flush()


# ───────────────────────────────────────────────
# 輔助函式區塊：建立錯誤 JSON 回應
# ───────────────────────────────────────────────
def build_error_response(code: str, detail: str) -> Dict[str, Any]:
    """建立錯誤格式的 JSON 回應。"""
    return {
        "ok": False,
        "error": code,
        "detail": detail,
    }


# ───────────────────────────────────────────────
# 輔助函式區塊：讀取 stdin 並解析 JSON
# ───────────────────────────────────────────────
def read_stdin_payload() -> Dict[str, Any]:
    """讀取 stdin 內容並解析為 JSON 物件。"""
    raw = sys.stdin.read()
    if not raw or not raw.strip():
        raise RunnerError("INVALID_INPUT", "stdin 為空或未提供任何 JSON")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RunnerError("INVALID_INPUT", f"stdin JSON 解析失敗: {exc}") from exc
    if not isinstance(payload, dict):
        raise RunnerError("INVALID_INPUT", "stdin JSON 必須為物件")
    return payload


# ───────────────────────────────────────────────
# 輔助函式區塊：正規化 stdin 請求格式（支援 op/action 與 payload）
# ───────────────────────────────────────────────
def normalize_request(payload: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """正規化 op 與參數來源，統一回傳推論必要欄位。

    規則說明：
    - 先從頂層 payload 讀取 op/action。
    - 若未提供 payload 子物件，parameters 保持與原先相同（整個頂層 payload）。
    - 若提供 payload 子物件：
      - 頂層除 op/action/payload 以外的欄位視為預設參數。
      - payload 子物件內的欄位會覆蓋頂層同名欄位。
      - 最終 parameters 不含 op/action/payload 這些控制欄位。
    """
    op = payload.get("op") or payload.get("action")
    if not op:
        raise RunnerError("INVALID_INPUT", "缺少 op/action 欄位")

    # 預設行為：與原本一致，若沒有 payload 子物件則直接使用整個頂層 payload。
    parameters: Dict[str, Any] = payload

    nested = payload.get("payload")
    if nested is not None:
        # 若有提供 payload 欄位但型別不是物件，視為錯誤輸入。
        if not isinstance(nested, dict):
            raise RunnerError("INVALID_INPUT", "payload 欄位必須為 JSON 物件")

        # 合併頂層參數與 payload 子物件：
        # - 先放入頂層欄位（排除 payload 本身）
        merged: Dict[str, Any] = {}
        for key, value in payload.items():
            if key != "payload":
                merged[key] = value

        # - 再由 payload 子物件覆蓋同名欄位
        merged.update(nested)

        # - 移除控制欄位，避免與參數混用
        for meta_key in ("op", "action", "payload"):
            merged.pop(meta_key, None)

        parameters = merged

    return str(op), parameters


# ───────────────────────────────────────────────
# 輔助函式區塊：驗證推論請求內容
# ───────────────────────────────────────────────
def validate_infer_request(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """驗證推論參數並回傳正規化結果。"""
    missing = [field for field in REQUIRED_FIELDS if field not in parameters]
    if missing:
        raise RunnerError("MISSING_FIELD", f"缺少必填欄位: {', '.join(missing)}")

    image_path = str(parameters.get("image_path", "")).strip()
    weights_path = str(parameters.get("weights_path", "")).strip()
    target_raw = parameters.get("target")
    conf_raw = parameters.get("conf")

    if not image_path or not weights_path:
        raise RunnerError("INVALID_INPUT", "image_path/weights_path 不可為空字串")
    
    # target 為選填欄位：若未提供或為空字串，視為不過濾目標
    target = None
    if target_raw is not None:
        target_str = str(target_raw).strip()
        if target_str:
            target = target_str

    try:
        conf_value = float(conf_raw)
    except (TypeError, ValueError) as exc:
        raise RunnerError("INVALID_INPUT", f"conf 不是有效數值: {exc}") from exc

    if conf_value < 0.0 or conf_value > 1.0:
        raise RunnerError("INVALID_INPUT", "conf 必須介於 0 到 1 之間")

    if not os.path.isfile(image_path):
        raise RunnerError("FILE_NOT_FOUND", f"找不到影像檔案: {image_path}")

    if not os.path.isfile(weights_path):
        raise RunnerError("FILE_NOT_FOUND", f"找不到權重檔案: {weights_path}")

    return {
        "image_path": image_path,
        "weights_path": weights_path,
        "target": target,
        "conf": conf_value,
    }


# ───────────────────────────────────────────────
# 主流程區塊：解析 stdin、驗證輸入、呼叫推論並輸出結果
# ───────────────────────────────────────────────
def main() -> None:
    """主程式入口。"""
    response: Dict[str, Any]
    exit_code = 0

    try:
        payload = read_stdin_payload()
        op, parameters = normalize_request(payload)
        if op != "infer":
            raise RunnerError("UNSUPPORTED_OP", f"不支援的操作: {op}")

        normalized = validate_infer_request(parameters)

        try:
            infer_result = infer(
                image_path=normalized["image_path"],
                weights_path=normalized["weights_path"],
                target=normalized["target"],
                conf=normalized["conf"],
            )
        except Exception as exc:
            raise RunnerError("INFER_FAILED", f"推論執行失敗: {exc}") from exc

        if not isinstance(infer_result, dict) or not infer_result.get("ok"):
            raise RunnerError("INFER_FAILED", "推論回傳格式異常或未標示 ok=true")

        response = infer_result
    except RunnerError as exc:
        response = build_error_response(exc.code, exc.detail)
        emit_stderr(f"[iotVisionTurret] {exc.code}: {exc.detail}")
        exit_code = 1
    except Exception as exc:
        response = build_error_response("UNEXPECTED_ERROR", f"未預期錯誤: {exc}")
        emit_stderr("[iotVisionTurret] 未預期例外發生，以下為 traceback:")
        emit_stderr(traceback.format_exc())
        exit_code = 1

    emit_stdout(response)
    sys.exit(exit_code)


if __name__ == "__main__":
    # 函式區塊用途：提供可直接執行的 runner 入口
    main()
