import argparse
import sys
import os
import threading
import queue
import time
import logging
import json
import struct

from scipy.signal import butter, sosfilt
import numpy as np
import tomli

parser = argparse.ArgumentParser(description="ttsEngine 語音合成")
parser.add_argument("--log-path", type=str, default="ttsEngine.log", help="輸出 log 檔案路徑")
args = parser.parse_args()

# 設定 log 紀錄，確保錯誤可追蹤
log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("ttsEngine")
logger.setLevel(logging.INFO)
file_handler = logging.FileHandler(args.log_path, encoding='utf-8')
file_handler.setFormatter(log_formatter)
logger.addHandler(file_handler)

# 切換用常數：TTS_THREAD_POOL=True 啟用 thread pool，多執行緒合成；False 僅單一執行緒
TTS_THREAD_POOL = False
TTS_POOL_SIZE = 4

# 加入模型路徑，確保可載入 f5_tts
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'f5_tts')))
from f5_tts.infer.utils_infer import (
    mel_spec_type, target_rms, cross_fade_duration, nfe_step, cfg_strength,
    sway_sampling_coef, speed, fix_duration, infer_process,
    load_model, load_vocoder, preprocess_ref_audio_text,
)
from omegaconf import OmegaConf

# 讀取設定檔，載入模型與參數
setting_path = os.path.join(os.path.dirname(__file__), 'f5_tts', 'infer', 'setting', 'setting.toml')
with open(setting_path, 'rb') as f:
    config = tomli.load(f)

ckpt_file = config.get('ckpt_file', '')
vocab_file = config.get('vocab_file', '')
ref_audio = config.get('ref_audio', '')
ref_text = config.get('ref_text', '')
vocoder_name = config.get('vocoder_name', mel_spec_type)
load_vocoder_from_local = config.get('load_vocoder_from_local', False)

cross_fade_duration = config.get('cross_fade_duration', cross_fade_duration)
nfe_step = config.get('nfe_step', nfe_step)
cfg_strength = config.get('cfg_strength', cfg_strength)
sway_sampling_coef = config.get('sway_sampling_coef', sway_sampling_coef)
speed = config.get('speed', speed)
fix_duration = config.get('fix_duration', fix_duration)
target_rms = config.get('target_rms', target_rms)

# 根據設定載入 vocoder
if vocoder_name == 'vocos':
    vocoder_local_path = os.path.join(os.path.dirname(__file__), 'f5_tts', 'infer', 'vocos')
elif vocoder_name == 'bigvgan':
    vocoder_local_path = '../checkpoints/bigvgan_v2_24khz_100band_256x'
else:
    vocoder_local_path = ''
vocoder = load_vocoder(vocoder_name=vocoder_name, is_local=load_vocoder_from_local, local_path=vocoder_local_path)

# 讀取模型設定並載入 TTS 模型
model_cfg = OmegaConf.load(config.get('model_cfg', os.path.join(os.path.dirname(__file__), 'f5_tts', 'configs', 'F5TTS_v1_Base.yaml'))).model
from f5_tts.model import DiT, UNetT  # noqa: F401 - Used dynamically via globals()
model_cls = globals()[model_cfg.backbone]
ema_model = load_model(model_cls, model_cfg.arch, ckpt_file, mel_spec_type=vocoder_name, vocab_file=vocab_file)

# 以下為音訊後處理工具，提升輸出品質

def depop_filter(audio, sr, fade_ms=15):
    fade_samples = int(sr * fade_ms / 1000)
    envelope = np.linspace(0, 1, fade_samples) ** 2
    audio[:fade_samples] *= envelope
    return audio


def bandstop_filter(audio, sr, lowcut=50, highcut=100):
    nyq = sr / 2
    sos = butter(2, [lowcut / nyq, highcut / nyq], btype='bandstop', output='sos')
    return sosfilt(sos, audio) * 0.9


def compress_audio(audio, threshold=0.7, ratio=2.0):
    return np.where(
        np.abs(audio) < threshold,
        audio,
        np.sign(audio) * (threshold + (np.abs(audio) - threshold) / ratio)
    )


def eq_audio(audio, sr):
    nyq = sr / 2
    low = butter(1, 300 / nyq, btype='highpass', output='sos')
    mid = butter(2, [300 / nyq, 6000 / nyq], btype='bandpass', output='sos')
    a_low = sosfilt(low, audio) * 0.9
    a_mid = sosfilt(mid, audio) * 1.0
    a_high = audio - (a_low + a_mid)
    a_high *= 1.1
    return a_low + a_mid + a_high


def fade(audio, sr, fade_ms=30):
    fs = int(sr * fade_ms / 1000)
    if len(audio) < 2 * fs:
        return audio
    fin = np.linspace(0, 1, fs)
    fout = np.linspace(1, 0, fs)
    audio[:fs] *= fin
    audio[-fs:] *= fout
    return audio


def exciter(audio: np.ndarray, sr: int, cutoff=3000, gain=0.1):
    nyq = sr / 2
    sos = butter(2, cutoff / nyq, btype='highpass', output='sos')
    hf = sosfilt(sos, audio)
    hf = np.sqrt(np.abs(hf))
    return audio + gain * hf


def soft_limiter(audio: np.ndarray, threshold=0.95):
    return threshold * np.tanh(audio / threshold)


def advanced_soften_audio(audio, sr):
    audio = depop_filter(audio, sr, fade_ms=15)
    audio = bandstop_filter(audio, sr, 50, 100)
    audio = compress_audio(audio, threshold=0.7, ratio=2.0)
    audio = eq_audio(audio, sr)
    audio = fade(audio, sr, fade_ms=30)
    audio = exciter(audio, sr, cutoff=3000, gain=0.1)
    audio = soft_limiter(audio, threshold=0.95)
    return audio


# 使用佇列處理輸入，避免主線程阻塞
input_queue = queue.Queue()
output_lock = threading.Lock()

# 單一 session 狀態管理，避免多 session 同時合成
session_state_lock = threading.Lock()
session_state = {
    "session_id": None,
    "status": "idle",  # idle | collecting | processing
    "text_parts": []
}

# 將 frame 封包寫入 stdout（長度前綴 + JSON header + PCM payload）
def write_frame(frame, payload=b""):
    try:
        frame_json = json.dumps(frame, ensure_ascii=False).encode("utf-8")
        frame_len = struct.pack(">I", len(frame_json))
        with output_lock:
            sys.stdout.buffer.write(frame_len)
            sys.stdout.buffer.write(frame_json)
            if payload:
                sys.stdout.buffer.write(payload)
            sys.stdout.buffer.flush()
    except Exception as exc:
        logger.exception(f"寫入 frame 失敗: {exc}")


# 統一輸出錯誤 frame，方便 Node 端辨識
def emit_error_frame(session_id, message, code="UNKNOWN_ERROR"):
    frame = {
        "type": "error",
        "session_id": session_id,
        "message": message,
        "code": code
    }
    write_frame(frame)


# 進行語音合成並把結果輸出到 stdout
def tts_worker():
    while True:
        item = input_queue.get()
        if item is None:
            input_queue.task_done()
            break
        session_id = item.get("session_id")
        text = item.get("text")
        try:
            # 進行模型推論，取得 PCM audio
            ref_audio_, ref_text_ = preprocess_ref_audio_text(ref_audio, ref_text)
            audio_segment, final_sample_rate, _ = infer_process(
                ref_audio_, ref_text_, text, ema_model, vocoder,
                mel_spec_type=vocoder_name, target_rms=target_rms,
                cross_fade_duration=cross_fade_duration, nfe_step=nfe_step,
                cfg_strength=cfg_strength, sway_sampling_coef=sway_sampling_coef,
                speed=speed, fix_duration=fix_duration,
            )
            # 進行音訊後處理，確保輸出品質與安全範圍
            audio = advanced_soften_audio(audio_segment, final_sample_rate)
            peak = np.max(np.abs(audio))
            if peak > 1.0:
                logger.warning(f"音訊振幅超過 1.0，正在壓縮 (peak={peak:.2f})")
                audio = audio / peak
            elif peak < 1e-3:
                logger.warning("音訊過小，將放大")
                audio = audio / (peak + 1e-6)
            safe_audio = np.clip(audio, -1.0, 1.0)
            pcm = (safe_audio * 32767).astype(np.int16).tobytes()

            # 輸出 start frame，描述音訊格式
            start_frame = {
                "type": "start",
                "session_id": session_id,
                "format": "pcm_s16le",
                "sample_rate": final_sample_rate,
                "channels": 1
            }
            write_frame(start_frame)

            # 依序輸出 audio frame，每段都附上 payload_bytes
            seq = 0
            chunk_size = 4096
            for offset in range(0, len(pcm), chunk_size):
                chunk = pcm[offset:offset + chunk_size]
                audio_frame = {
                    "type": "audio",
                    "session_id": session_id,
                    "seq": seq,
                    "payload_bytes": len(chunk)
                }
                write_frame(audio_frame, payload=chunk)
                seq += 1

            # 輸出 done frame，通知 Node 端結束
            done_frame = {
                "type": "done",
                "session_id": session_id
            }
            write_frame(done_frame)
        except Exception as exc:
            # 合成過程發生錯誤時，回傳 error frame 並記錄 log
            logger.exception(f"ttsEngine 合成失敗: {exc}")
            emit_error_frame(session_id, f"ttsEngine 合成失敗: {exc}", code="SYNTH_FAIL")
        finally:
            # 無論成功或失敗，都釋放 session，允許下一次合成
            with session_state_lock:
                session_state["session_id"] = None
                session_state["status"] = "idle"
                session_state["text_parts"] = []
            input_queue.task_done()


# 監聽 stdin（JSON Lines），解析增量輸入並加入佇列
def stdin_listener():
    for line in sys.stdin:
        raw_text = line.strip()
        if not raw_text:
            continue
        session_id = None
        try:
            # 解析 JSONL，取得 type/session_id 以及 text
            payload = json.loads(raw_text)
            event_type = payload.get("type")
            session_id = payload.get("session_id")
            if event_type not in {"text", "end"} or not session_id:
                logger.error("輸入 JSON 缺少 type 或 session_id")
                if session_id:
                    emit_error_frame(session_id, "輸入 JSON 缺少 type 或 session_id", code="INVALID_INPUT")
                continue

            with session_state_lock:
                current_id = session_state["session_id"]
                status = session_state["status"]

                if status != "idle" and current_id != session_id:
                    # 單一 session 限制：不同 session 同時輸入直接回錯誤
                    logger.error(f"收到不同 session_id={session_id}，但目前忙碌中: {current_id}")
                    emit_error_frame(session_id, "已有 session 正在處理，請稍後再試", code="SESSION_INFLIGHT")
                    continue

                if event_type == "text":
                    input_text = payload.get("text")
                    if not input_text:
                        logger.error("text 事件缺少 text 欄位")
                        emit_error_frame(session_id, "text 事件缺少 text 欄位", code="INVALID_INPUT")
                        continue
                    # 設定或延續收集狀態，允許同 session 多次輸入
                    if status == "idle":
                        session_state["session_id"] = session_id
                        session_state["status"] = "collecting"
                    if session_state["status"] == "processing":
                        logger.error("session 已結束輸入，等待處理完成")
                        emit_error_frame(session_id, "session 已結束輸入，無法再追加 text", code="SESSION_CLOSED")
                        continue
                    session_state["text_parts"].append(input_text)
                    continue

                if event_type == "end":
                    # 只有在 collecting 狀態才允許結束
                    if status == "idle":
                        logger.error("收到 end 但尚未開始 session")
                        emit_error_frame(session_id, "收到 end 但尚未開始 session", code="INVALID_STATE")
                        continue
                    if status == "processing":
                        logger.error("收到重複 end，session 已在處理中")
                        emit_error_frame(session_id, "session 已在處理中，無法重複 end", code="INVALID_STATE")
                        continue
                    combined_text = "".join(session_state["text_parts"])
                    if not combined_text.strip():
                        logger.error("收到 end 但 text 為空")
                        emit_error_frame(session_id, "收到 end 但 text 為空", code="INVALID_INPUT")
                        session_state["session_id"] = None
                        session_state["status"] = "idle"
                        session_state["text_parts"] = []
                        continue
                    session_state["status"] = "processing"
                    # 在鎖外加入佇列，避免阻塞其他輸入
                    input_queue.put({"session_id": session_id, "text": combined_text})
        except Exception as exc:
            # JSON 解析或流程錯誤時，記錄 log 並回傳錯誤 frame
            logger.exception(f"解析 stdin 失敗: {exc}")
            if session_id:
                emit_error_frame(session_id, f"JSON parsing error: {str(exc)}", code="PARSE_ERROR")


# 啟動處理執行緒
if TTS_THREAD_POOL:
    tts_threads = []
    for _ in range(TTS_POOL_SIZE):
        t = threading.Thread(target=tts_worker)
        t.start()
        tts_threads.append(t)
else:
    tts_thread = threading.Thread(target=tts_worker)
    tts_thread.start()
threading.Thread(target=stdin_listener, daemon=True).start()

logger.info('ttsEngine ready. Waiting for input...')

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    logger.info('ttsEngine 收到中斷訊號，準備關閉')
except Exception as exc:
    logger.exception(f"主迴圈發生錯誤: {exc}")
finally:
    # 結束時清理執行緒，確保不留殘留資源
    if TTS_THREAD_POOL:
        for _ in range(TTS_POOL_SIZE):
            input_queue.put(None)
        for t in tts_threads:
            t.join()
    else:
        input_queue.put(None)
        tts_thread.join()
    logger.info('ttsEngine 已完成所有處理')
