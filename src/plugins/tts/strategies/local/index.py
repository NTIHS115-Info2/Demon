import argparse
import sys
import os
import threading
import queue
import time
import logging

import simpleaudio as sa

from scipy.signal import butter, lfilter ,sosfilt
import numpy as np
import tomli
from datetime import datetime

parser = argparse.ArgumentParser(description="Whisper 即時語音辨識")
parser.add_argument("--log-path", type=str, default="tts.log", help="輸出 log 檔案路徑")
args = parser.parse_args()

# 設定 log 紀錄
log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("tts")
logger.setLevel(logging.INFO)
file_handler = logging.FileHandler(args.log_path, encoding='utf-8')
file_handler.setFormatter(log_formatter)
logger.addHandler(file_handler)

# 切換用常數：TTS_THREAD_POOL=True 啟用 thread pool，多執行緒 TTS；False 僅單一 TTS
TTS_THREAD_POOL = False
TTS_POOL_SIZE = 4

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'f5_tts')))
from f5_tts.infer.utils_infer import (
    mel_spec_type, target_rms, cross_fade_duration, nfe_step, cfg_strength,
    sway_sampling_coef, speed, fix_duration, infer_process,
    load_model, load_vocoder, preprocess_ref_audio_text,
)
from omegaconf import OmegaConf

# 讀取設定
setting_path = os.path.join(os.path.dirname(__file__), 'f5_tts', 'infer', 'setting', 'setting.toml')
with open(setting_path, 'rb') as f:
    config = tomli.load(f)

ckpt_file = config.get('ckpt_file', '')
vocab_file = config.get('vocab_file', '')
ref_audio = config.get('ref_audio', '')
ref_text = config.get('ref_text', '')
vocoder_name = config.get('vocoder_name', mel_spec_type)
load_vocoder_from_local = config.get('load_vocoder_from_local', False)
output_dir = config.get('output_dir', '')
if not output_dir:
    output_dir = os.path.join(os.path.dirname(__file__), 'output')
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

cross_fade_duration = config.get('cross_fade_duration', cross_fade_duration)
nfe_step = config.get('nfe_step', nfe_step)
cfg_strength = config.get('cfg_strength', cfg_strength)
sway_sampling_coef = config.get('sway_sampling_coef', sway_sampling_coef)
speed = config.get('speed', speed)
fix_duration = config.get('fix_duration', fix_duration)
target_rms = config.get('target_rms', target_rms)
IDLE_SECONDS = config.get('idle_seconds', 2)

if vocoder_name == 'vocos':
    vocoder_local_path = os.path.join(os.path.dirname(__file__), 'f5_tts', 'infer', 'vocos')
elif vocoder_name == 'bigvgan':
    vocoder_local_path = '../checkpoints/bigvgan_v2_24khz_100band_256x'
else:
    vocoder_local_path = ''
vocoder = load_vocoder(vocoder_name=vocoder_name, is_local=load_vocoder_from_local, local_path=vocoder_local_path)

model_cfg = OmegaConf.load(config.get('model_cfg', os.path.join(os.path.dirname(__file__), 'f5_tts', 'configs', 'F5TTS_v1_Base.yaml'))).model
from f5_tts.model import DiT, UNetT
model_cls = globals()[model_cfg.backbone]
ema_model = load_model(model_cls, model_cfg.arch, ckpt_file, mel_spec_type=vocoder_name, vocab_file=vocab_file)

def depop_filter(audio, sr, fade_ms=15):
    fade_samples = int(sr * fade_ms / 1000)
    envelope = np.linspace(0,1,fade_samples)**2
    audio[:fade_samples] *= envelope
    return audio

def bandstop_filter(audio, sr, lowcut=50, highcut=100):
    nyq = sr/2
    sos = butter(2, [lowcut/nyq, highcut/nyq], btype='bandstop', output='sos')
    return sosfilt(sos, audio) * 0.9

def compress_audio(audio, threshold=0.7, ratio=2.0):
    return np.where(
        np.abs(audio) < threshold,
        audio,
        np.sign(audio) * (threshold + (np.abs(audio)-threshold)/ratio)
    )

def eq_audio(audio, sr):
    nyq = sr/2
    low = butter(1, 300/nyq, btype='highpass', output='sos')
    mid = butter(2, [300/nyq, 6000/nyq], btype='bandpass', output='sos')
    a_low  = sosfilt(low,  audio)*0.9
    a_mid  = sosfilt(mid,  audio)*1.0
    a_high = audio - (a_low + a_mid)
    a_high *= 1.1
    return a_low + a_mid + a_high

def fade(audio, sr, fade_ms=30):
    fs = int(sr*fade_ms/1000)
    if len(audio)<2*fs: return audio
    fin = np.linspace(0,1,fs)
    fout= np.linspace(1,0,fs)
    audio[:fs]   *= fin
    audio[-fs:]  *= fout
    return audio

def exciter(audio: np.ndarray, sr: int, cutoff=3000, gain=0.1):
    nyq = sr / 2
    sos = butter(2, cutoff/nyq, btype='highpass', output='sos')
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

input_queue = queue.Queue()
play_queue = queue.Queue()
cache_audio = []
cache_text = []
lock = threading.Lock()
last_save_time = time.time()

def tts_worker():
    while True:
        text = input_queue.get()
        if text is None:
            input_queue.task_done()
            break
        ref_audio_, ref_text_ = preprocess_ref_audio_text(ref_audio, ref_text)
        audio_segment, final_sample_rate, _ = infer_process(
            ref_audio_, ref_text_, text, ema_model, vocoder,
            mel_spec_type=vocoder_name, target_rms=target_rms,
            cross_fade_duration=cross_fade_duration, nfe_step=nfe_step,
            cfg_strength=cfg_strength, sway_sampling_coef=sway_sampling_coef,
            speed=speed, fix_duration=fix_duration,
        )
        play_queue.put((audio_segment, final_sample_rate, text))
        input_queue.task_done()

def play_worker():
    global last_save_time
    while True:
        item = play_queue.get()
        if item is None:
            play_queue.task_done()
            break
        audio, sample_rate, text = item
        audio = advanced_soften_audio(audio, sample_rate)
        peak = np.max(np.abs(audio))
        if peak > 1.0:
            logger.warning(f"音訊振幅超過 1.0，正在壓縮 (peak={peak:.2f})")
            audio = audio / peak
        elif peak < 1e-3:
            logger.warning("音訊過小，將放大")
            audio = audio / (peak + 1e-6)
        safe_audio = np.clip(audio, -1.0, 1.0)
        pcm = (safe_audio * 32767).astype(np.int16)
        play_obj = sa.play_buffer(pcm, 1, 2, sample_rate)
        logger.info(f"播放「{text}」, 時長 {len(audio)/sample_rate:.2f}s")
        play_obj.wait_done()
        with lock:
            cache_audio.append(audio)
            cache_text.append(text)
            last_save_time = time.time()
        play_queue.task_done()

def idle_monitor():
    global cache_audio, cache_text, last_save_time
    while True:
        time.sleep(1)
        with lock:
            idle = time.time() - last_save_time
            if idle > IDLE_SECONDS and cache_audio:
                save_audio_and_text(cache_audio, cache_text)
                cache_audio = []
                cache_text = []

def save_audio_and_text(audio_list, text_list):
    if not audio_list:
        return
    now = datetime.now().strftime('%Y%m%d_%H%M%S')
    save_path = os.path.join(output_dir, now)
    os.makedirs(save_path, exist_ok=True)
    audio = np.concatenate(audio_list)
    import soundfile as sf
    sf.write(os.path.join(save_path, 'output.wav'), audio, 24000)
    with open(os.path.join(save_path, 'input.txt'), 'w', encoding='utf-8') as f:
        for t in text_list:
            f.write(t + '\n')
    logger.info(f'Saved to {save_path}')

threading.Thread(target=idle_monitor, daemon=True).start()

if TTS_THREAD_POOL:
    tts_threads = []
    for _ in range(TTS_POOL_SIZE):
        t = threading.Thread(target=tts_worker)
        t.start()
        tts_threads.append(t)
else:
    tts_thread = threading.Thread(target=tts_worker)
    tts_thread.start()

play_thread = threading.Thread(target=play_worker)
play_thread.start()

logger.info('infer_server ready. Waiting for input...')

def stdin_listener():
    for line in sys.stdin:
        text = line.strip()
        if text:
            input_queue.put(text)

threading.Thread(target=stdin_listener, daemon=True).start()

try:
    while True:
        time.sleep(1)
finally:
    if TTS_THREAD_POOL:
        for _ in range(TTS_POOL_SIZE):
            input_queue.put(None)
        for t in tts_threads:
            t.join()
    else:
        input_queue.put(None)
        tts_thread.join()
    play_queue.put(None)
    play_thread.join()
    time.sleep(IDLE_SECONDS + 1)
    with lock:
        if cache_audio:
            save_audio_and_text(cache_audio, cache_text)
            cache_audio = []
            cache_text = []
    logger.info('全部處理完畢')