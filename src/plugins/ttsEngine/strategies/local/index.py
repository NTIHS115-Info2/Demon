import argparse
import sys
import os
import threading
import queue
import time
import logging
import json
import base64

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


# 使用佇列處理輸入與輸出，避免主線程阻塞
input_queue = queue.Queue()
output_queue = queue.Queue()
output_lock = threading.Lock()


# 進行語音合成並把結果放入輸出佇列

def tts_worker():
    while True:
        item = input_queue.get()
        if item is None:
            input_queue.task_done()
            break
        request_id = item.get("id")
        text = item.get("text")
        try:
            ref_audio_, ref_text_ = preprocess_ref_audio_text(ref_audio, ref_text)
            audio_segment, final_sample_rate, _ = infer_process(
                ref_audio_, ref_text_, text, ema_model, vocoder,
                mel_spec_type=vocoder_name, target_rms=target_rms,
                cross_fade_duration=cross_fade_duration, nfe_step=nfe_step,
                cfg_strength=cfg_strength, sway_sampling_coef=sway_sampling_coef,
                speed=speed, fix_duration=fix_duration,
            )
            audio = advanced_soften_audio(audio_segment, final_sample_rate)
            peak = np.max(np.abs(audio))
            if peak > 1.0:
                logger.warning(f"音訊振幅超過 1.0，正在壓縮 (peak={peak:.2f})")
                audio = audio / peak
            elif peak < 1e-3:
                logger.warning("音訊過小，將放大")
                audio = audio / (peak + 1e-6)
            safe_audio = np.clip(audio, -1.0, 1.0)
            pcm = (safe_audio * 32767).astype(np.int16)

            # 方案 A：回傳完整音訊資料（base64 PCM）與 metadata
            payload = {
                "id": request_id,
                "format": "pcm_s16le",
                "sample_rate": final_sample_rate,
                "audio_base64": base64.b64encode(pcm.tobytes()).decode("utf-8")
            }
            output_queue.put(payload)
        except Exception as exc:
            logger.exception(f"ttsEngine 合成失敗: {exc}")
            output_queue.put({"id": request_id, "error": str(exc)})
        finally:
            input_queue.task_done()


# 將輸出統一寫到 stdout，讓 Node.js 接收

def output_worker():
    while True:
        payload = output_queue.get()
        if payload is None:
            output_queue.task_done()
            break
        try:
            with output_lock:
                print(json.dumps(payload, ensure_ascii=False), flush=True)
        except Exception as exc:
            logger.exception(f"ttsEngine 輸出失敗: {exc}")
        finally:
            output_queue.task_done()


# 監聽 stdin，解析 JSON 請求並加入佇列

def stdin_listener():
    for line in sys.stdin:
        text = line.strip()
        if not text:
            continue
        request_id = None
        try:
            payload = json.loads(text)
            request_id = payload.get("id")
            input_text = payload.get("text")
            if not request_id or not input_text:
                logger.error("輸入 JSON 缺少 id 或 text")
                if request_id:
                    output_queue.put({"id": request_id, "error": "Missing required field: text"})
                continue
            input_queue.put({"id": request_id, "text": input_text})
        except Exception as exc:
            logger.exception(f"解析 stdin 失敗: {exc}")
            if request_id:
                output_queue.put({"id": request_id, "error": f"JSON parsing error: {str(exc)}"})


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

output_thread = threading.Thread(target=output_worker)
output_thread.start()
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
    output_queue.put(None)
    output_thread.join()
    logger.info('ttsEngine 已完成所有處理')
