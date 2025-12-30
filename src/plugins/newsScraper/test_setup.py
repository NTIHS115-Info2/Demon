import asyncio
import sys
from pathlib import Path

strategies_path = Path(__file__).resolve().parent / "strategies"
sys.path.insert(0, str(strategies_path))

from local.researcher import ResearcherStrategy


def _format_output(result):
    try:
        return result.model_dump_json(ensure_ascii=False)
    except Exception:
        return str(result)


async def main():
    researcher = ResearcherStrategy()
    loaded_path = researcher.aggregator.loaded_settings_path
    print(f"Loaded config from: {loaded_path}")

    try:
        result = await researcher.discover_sources("plugin_test", num_results=3)
    except Exception as exc:
        print(f"Search failed unexpectedly: {exc}")
        return

    print(_format_output(result))


if __name__ == "__main__":
    asyncio.run(main())
