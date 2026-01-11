#!/usr/bin/env python3
# 檔案用途：提供 iotVisionTurret 本地策略的 Python runner 入口（stub）

import json
import sys
import select
from typing import Any, Dict

# 狀態資料結構區塊：保存 runner 基本資訊與執行結果
STATE: Dict[str, Any] = {
    "mode": "stub",
    "version": "0.1",
}


def read_stdin_json(timeout_seconds: float = 5.0) -> Dict[str, Any]:
    """讀取 stdin 的 JSON 請求內容，帶有超時保護。"""
    try:
        # 使用 select 進行超時控制（Unix/Linux 系統）
        if hasattr(select, 'select'):
            ready, _, _ = select.select([sys.stdin], [], [], timeout_seconds)
            if not ready:
                return {
                    "_error": {
                        "message": "stdin 讀取逾時",
                        "code": "STDIN_TIMEOUT",
                    }
                }
        raw = sys.stdin.read()
        if not raw:
            return {}
        return json.loads(raw)
    except Exception as exc:
        return {
            "_error": {
                "message": f"stdin JSON 解析失敗: {exc}",
                "code": "STDIN_PARSE_ERROR",
            }
        }


def build_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    """組裝 stub 回應內容。"""
    if "_error" in payload:
        return {"ok": False, "error": payload["_error"]}

    action = payload.get("action", "unknown")
    return {
        "ok": True,
        "mode": STATE["mode"],
        "message": "iotVisionTurret local python runner ready",
        "action": action,
        "payload": payload.get("payload"),
    }


def main() -> None:
    """主程式入口，讀取 stdin 並輸出 JSON 回應。"""
    try:
        payload = read_stdin_json()
        response = build_response(payload)
        sys.stdout.write(json.dumps(response, ensure_ascii=False))
    except Exception as exc:
        error_response = {
            "ok": False,
            "error": {
                "message": f"runner 執行失敗: {exc}",
                "code": "RUNNER_ERROR",
                "type": exc.__class__.__name__,
            },
        }
        sys.stderr.write(json.dumps(error_response, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    # 函式區塊用途：提供可直接執行的 runner 入口
    main()
