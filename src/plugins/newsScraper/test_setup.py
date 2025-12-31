# src/plugins/newsScraper/test_setup.py
import asyncio
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CURRENT_DIR))

from strategies.local.researcher import ResearcherStrategy


async def run_test():
    researcher = ResearcherStrategy()
    settings_path = researcher.aggregator.settings_source_path
    print(f"Loaded config from: {settings_path}")

    try:
        result = await researcher.discover_sources("plugin_test", num_results=3)
        if result.success:
            print("Search succeeded.")
            print(result.model_dump_json(indent=2))
        else:
            print("Search failed gracefully.")
            print(result.model_dump_json(indent=2))
    except Exception as exc:  # pragma: no cover - 測試腳本容錯
        print(f"Search crashed unexpectedly: {exc}")


def main():
    asyncio.run(run_test())


if __name__ == "__main__":
    main()
