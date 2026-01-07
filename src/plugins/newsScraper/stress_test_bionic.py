import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Tuple


def run_instance(script_path: Path, payload: Dict[str, str]) -> Tuple[float, float, float]:
    env = os.environ.copy()
    env["BIONIC_TRACE"] = "1"
    start_time = time.time()
    completed = subprocess.run(
        [sys.executable, str(script_path), json.dumps(payload)],
        capture_output=True,
        text=True,
        env=env,
    )
    end_time = time.time()
    request_time = _extract_request_time(completed.stderr)
    return start_time, request_time, end_time


def _extract_request_time(stderr_output: str) -> float:
    for line in stderr_output.splitlines():
        if line.startswith("BIONIC_REQUEST_TS"):
            _, timestamp = line.split(maxsplit=1)
            return float(timestamp)
    return 0.0


def main() -> None:
    script_path = Path(__file__).resolve().parent / "strategies" / "local" / "researcher.py"
    payload = {
        "topic": "test news",
        "query": "",
        "detail_level": "quick",
    }

    results: List[Tuple[float, float, float]] = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(run_instance, script_path, payload) for _ in range(5)]
        for future in futures:
            results.append(future.result())

    request_times = sorted(ts for _, ts, _ in results if ts > 0)
    print("Request timestamps:")
    for ts in request_times:
        print(f"- {ts:.6f}")

    if len(request_times) >= 2:
        gaps = [request_times[i + 1] - request_times[i] for i in range(len(request_times) - 1)]
        print("Request gaps:")
        for gap in gaps:
            print(f"- {gap:.2f}s")


if __name__ == "__main__":
    main()
