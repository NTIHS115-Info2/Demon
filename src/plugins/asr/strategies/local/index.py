import argparse
import whisper
import sounddevice as sd
import numpy as np
import queue
import json
import webrtcvad
import sys
import torch
import os
import logging
from datetime import datetime
import time

# 命令列參數解析
parser = argparse.ArgumentParser(description="Whisper 即時語音辨識")
parser.add_argument("--device-name", type=str, default="USB麥克風" , help="輸入裝置名稱關鍵字（例如 'microphone'）")
parser.add_argument("--device-id", type=int, help="音訊輸入裝置 ID")
parser.add_argument("--use-cpu", action="store_true", help="強制使用 CPU 而非 GPU")
parser.add_argument("--blacklist", type=str, default="", help="以逗號分隔的黑名單關鍵詞")
parser.add_argument("--model", type=str, default="large-v3", help="Whisper 模型名稱（如 tiny, base, small, large-v3）")
parser.add_argument("--log-path", type=str, default="asr_log.txt", help="輸出 log 檔案路徑")
parser.add_argument("--slice-duration", type=float, default=4.0, help="切片錄音長度 (秒)")
args = parser.parse_args()

# 如果指定了名稱，根據名稱找 device_id
if args.device_name:
    device_name_lc = args.device_name.lower()
    matched_devices = [
        (i, dev['name']) for i, dev in enumerate(sd.query_devices())
        if dev['max_input_channels'] > 0 and device_name_lc in dev['name'].lower()
    ]
    if not matched_devices:
        print(f"❌ 找不到符合名稱 '{args.device_name}' 的音訊輸入裝置")
        print("🧩 提示：你可以使用 --device-id -1 查看所有裝置")
        sys.exit(1)
    args.device_id = matched_devices[0][0]
    print(f"✅ 使用裝置 [{args.device_id}]：{matched_devices[0][1]}", flush=True)


# 設定 log 紀錄
log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("ASR")
logger.setLevel(logging.INFO)
file_handler = logging.FileHandler(args.log_path, encoding='utf-8')
file_handler.setFormatter(log_formatter)
logger.addHandler(file_handler)

# 選擇設備
device = "cpu"# if args.use_cpu else ("cuda" if torch.cuda.is_available() else "cpu")

# 載入 Whisper 模型
try:
    logger.info(f"正在載入 Whisper 模型 '{args.model}' 到 {device.upper()}...")
    model = whisper.load_model(args.model , device=device)
    logger.info(f"模型載入成功！使用設備：{device}")
except Exception as e:
    logger.error(f"模型載入失敗：{e}")
    sys.exit(1)

# 黑名單處理
default_blacklist = "请不吝点赞,订阅,转发,打赏,支持明镜与点点栏目,谢谢大家,请订阅我的频道,欢迎收看本期节目,明镜与点点栏目"
additional_blacklist = [s.strip() for s in args.blacklist.split(",") if s.strip()]
FORBIDDEN_PHRASES = list(set(default_blacklist.split(",") + additional_blacklist))
logger.info(f"黑名單關鍵詞：共{len(FORBIDDEN_PHRASES)}個關鍵詞")

# 音訊參數
SAMPLERATE = 16000
FRAME_DURATION_MS = 30
FRAME_SIZE = int(SAMPLERATE * FRAME_DURATION_MS / 1000)
MIN_SPEECH_SECONDS = 0.5
MIN_VOLUME_THRESHOLD = 0.002
PARTIAL_INTERVAL = 2.0  # seconds between partial transcriptions
SLICE_DURATION = max(args.slice_duration, 1.0)
SLICE_LENGTH_SAMPLES = int(SAMPLERATE * SLICE_DURATION)
STEP_SAMPLES = SLICE_LENGTH_SAMPLES // 2

audio_q = queue.Queue()
vad = webrtcvad.Vad(1)

def print_json_output(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

def should_transcribe(audio_np: np.ndarray) -> bool:
    if len(audio_np) < SAMPLERATE * MIN_SPEECH_SECONDS:
        logger.info("語音段過短，跳過辨識")
        return False
    rms_volume = np.sqrt(np.mean(audio_np ** 2))
    if rms_volume < MIN_VOLUME_THRESHOLD:
        logger.info(f"音量過低（{rms_volume:.5f}），跳過辨識")
        return False
    return True

def is_forbidden(text: str) -> bool:
    return any(bad_phrase in text for bad_phrase in FORBIDDEN_PHRASES)

def callback(indata, frames, time, status):
    if status:
        logger.warning(f"音訊狀態：{status}")
    audio_q.put(bytes(indata))

def listen(device_id: int = None):
    try:
        stream_args = {
            "samplerate": SAMPLERATE,
            "blocksize": FRAME_SIZE,
            "dtype": 'int16',
            "channels": 1,
            "callback": callback
        }
        if device_id is not None:
            stream_args["device"] = device_id

        with sd.RawInputStream(**stream_args):
            logger.info("開始語音辨識，請開始說話...")
            speech_buffer = bytearray()
            triggered = False
            silence_counter = 0
            transcripts = []

            while True:
                data = audio_q.get()
                is_speech = vad.is_speech(data, SAMPLERATE)

                if is_speech:
                    speech_buffer.extend(data)
                    if not triggered:
                        triggered = True
                        silence_counter = 0
                        print("asr_start", flush=True)
                    else:
                        silence_counter = 0

                    while len(speech_buffer) // 2 >= SLICE_LENGTH_SAMPLES:
                        audio_slice = speech_buffer[:SLICE_LENGTH_SAMPLES * 2]
                        audio_np = np.frombuffer(audio_slice, dtype=np.int16).astype(np.float32) / 32768.0
                        if should_transcribe(audio_np):
                            try:
                                result = model.transcribe(
                                    audio_np,
                                    language='zh',
                                    temperature=0,
                                    no_speech_threshold=0.5
                                )
                                text = result.get("text", "").strip()
                                if text and not is_forbidden(text):
                                    logger.info(f"[即時輸出] {text}")
                                    print_json_output({"partial": text})
                                    transcripts.append(text)
                            except Exception as e:
                                logger.error(f"Whisper 即時辨識錯誤：{e}")
                        speech_buffer = speech_buffer[STEP_SAMPLES * 2:]

                elif triggered:
                    speech_buffer.extend(data)
                    silence_counter += 1
                    if silence_counter > (int(500 / FRAME_DURATION_MS)):
                        while len(speech_buffer) // 2 >= MIN_SPEECH_SECONDS * SAMPLERATE:
                            slice_len = min(len(speech_buffer) // 2, SLICE_LENGTH_SAMPLES)
                            audio_slice = speech_buffer[:slice_len * 2]
                            audio_np = np.frombuffer(audio_slice, dtype=np.int16).astype(np.float32) / 32768.0
                            if should_transcribe(audio_np):
                                try:
                                    result = model.transcribe(
                                        audio_np,
                                        language='zh',
                                        temperature=0,
                                        no_speech_threshold=0.5
                                    )
                                    text = result.get("text", "").strip()
                                    if text and not is_forbidden(text):
                                        transcripts.append(text)
                                except Exception as e:
                                    logger.error(f"Whisper 辨識錯誤：{e}")
                            speech_buffer = speech_buffer[STEP_SAMPLES * 2:] if len(speech_buffer) // 2 >= STEP_SAMPLES else bytearray()
                        final_text = "".join(transcripts)
                        if final_text:
                            logger.info(f"[辨識輸出] {final_text}")
                            print_json_output({"text": final_text})
                        else:
                            logger.info("已過濾幻聽輸出或無有效語音")
                            print("asr_ignore", flush=True)
                        triggered = False
                        speech_buffer = bytearray()
                        transcripts = []
                        silence_counter = 0
    except Exception as e:
        logger.error(f"無法開啟音訊串流：{e}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        listen(device_id=args.device_id)
    except KeyboardInterrupt:
        logger.info("程式已停止")
