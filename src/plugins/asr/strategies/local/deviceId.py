import sounddevice as sd
import sys

if __name__ == "__main__":
    print("可用的音訊輸入裝置清單：")
    print("=" * 40)
    for i, dev in enumerate(sd.query_devices()):
        if dev['max_input_channels'] > 0:
            print(f"[{i}] {dev['name']} (輸入通道: {dev['max_input_channels']})")
    print("=" * 40)
    sys.exit(0)
