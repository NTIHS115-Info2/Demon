import argparse
import json
import logging
import math
import os
import sys

import torch
import whisper

# 段落說明：解析命令列參數，定義檔案轉寫所需的輸入欄位
parser = argparse.ArgumentParser(description="Whisper 檔案轉寫服務")
parser.add_argument("--file-path", type=str, required=True, help="音訊檔案路徑")
parser.add_argument("--lang", type=str, default="zh", help="語言代碼")
parser.add_argument("--model", type=str, default="large-v3", help="Whisper 模型名稱")
parser.add_argument("--log-path", type=str, default="asr_log.txt", help="輸出 log 檔案路徑")
parser.add_argument("--use-cpu", action="store_true", help="強制使用 CPU 而非 GPU")
args = parser.parse_args()

# 段落說明：設定 log 輸出，方便檔案轉寫問題追蹤
log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("ASR")
logger.setLevel(logging.INFO)

# 段落說明：確保 log 目錄存在，避免 file handler 建立失敗
try:
    log_dir = os.path.dirname(args.log_path)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir, exist_ok=True)
    file_handler = logging.FileHandler(args.log_path, encoding='utf-8')
    file_handler.setFormatter(log_formatter)
    logger.addHandler(file_handler)
except Exception as e:
    # 段落說明：若 log handler 設定失敗，仍繼續執行但無法寫入 log
    print(json.dumps({
        "error": {
            "code": "ASR_FAILED",
            "message": f"無法建立 log 檔案：{e}"
        }
    }, ensure_ascii=False), file=sys.stderr, flush=True)

# 段落說明：統一 JSON 輸出格式，維持上層解析一致性
def print_json_output(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

# 段落說明：檢查檔案是否存在，避免後續轉寫流程中斷
# 段落說明：路徑安全性檢查，避免目錄穿越攻擊
try:
    file_path_resolved = os.path.realpath(args.file_path)
    base_dir = os.path.realpath(os.getenv("ASR_INPUT_BASE_DIR", os.getcwd()))
    
    # 段落說明：確認解析後的檔案路徑在允許的目錄底下
    if os.path.commonpath([file_path_resolved, base_dir]) != base_dir:
        print_json_output({
            "error": {
                "code": "ASR_FILE_NOT_FOUND",
                "message": "指定的檔案路徑不被允許"
            }
        })
        sys.exit(1)
    
    if not os.path.isfile(file_path_resolved):
        print_json_output({
            "error": {
                "code": "ASR_FILE_NOT_FOUND",
                "message": "找不到指定的音訊檔案"
            }
        })
        sys.exit(1)
except Exception as e:
    print_json_output({
        "error": {
            "code": "ASR_FILE_NOT_FOUND",
            "message": f"檔案路徑驗證失敗：{e}"
        }
    })
    sys.exit(1)

# 段落說明：選擇運算裝置，確保模型能在適當硬體執行
device = "cpu" if args.use_cpu else ("cuda" if torch.cuda.is_available() else "cpu")

# 段落說明：載入 Whisper 模型，失敗時回報明確錯誤
try:
    logger.info(f"正在載入 Whisper 模型 '{args.model}' 到 {device.upper()}...")
    model = whisper.load_model(args.model, device=device)
    logger.info(f"模型載入成功，使用設備：{device}")
except Exception as e:
    logger.error(f"模型載入失敗：{e}")
    print_json_output({
        "error": {
            "code": "ASR_FAILED",
            "message": "Whisper 模型載入失敗"
        }
    })
    sys.exit(1)

# 段落說明：執行檔案轉寫並組裝回傳結構
try:
    audio = whisper.load_audio(file_path_resolved)
    duration_ms = round(len(audio) / whisper.audio.SAMPLE_RATE * 1000)

    result = model.transcribe(
        file_path_resolved,
        language=args.lang,
        temperature=0,
        no_speech_threshold=0.5
    )

    text = (result.get("text") or "").strip()
    segments_payload = []
    segment_logprobs = []

    for segment in result.get("segments") or []:
        segments_payload.append({
            "start_ms": int(segment.get("start", 0) * 1000),
            "end_ms": int(segment.get("end", 0) * 1000),
            "text": (segment.get("text") or "").strip()
        })
        if "avg_logprob" in segment:
            segment_logprobs.append(segment.get("avg_logprob"))

    confidence = None
    if segment_logprobs:
        # 段落說明：數值穩定性改善，避免 exp 計算溢位或下溢
        confidence_value = sum(
            math.exp(max(-50.0, min(50.0, value)))
            for value in segment_logprobs
        ) / len(segment_logprobs)
        confidence = max(0.0, min(1.0, confidence_value))

    print_json_output({
        "text": text,
        "confidence": confidence,
        "duration_ms": duration_ms,
        "segments": segments_payload if segments_payload else None
    })
except Exception as e:
    logger.error(f"轉寫失敗：{e}")
    print_json_output({
        "error": {
            "code": "ASR_FAILED",
            "message": "音訊轉寫失敗"
        }
    })
    sys.exit(1)
