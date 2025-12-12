# src/plugins/newsScraper/strategies/local/researcher.py
import asyncio
import hashlib
import json
import os
import sys
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List

import requests
from bs4 import BeautifulSoup
from fake_useragent import UserAgent
from loguru import logger

from .data_models import ResearcherOutput, ResearcherResult


class SearchProvider(ABC):
    """抽象搜尋供應商。"""

    def __init__(self, settings: Dict[str, str]):
        self.settings = settings

    @abstractmethod
    def search(self, query: str, num_results: int) -> List[str]:
        """執行搜尋並回傳 URL 清單。"""


class GoogleSearchProvider(SearchProvider):
    api_url = "https://www.googleapis.com/customsearch/v1"

    def search(self, query: str, num_results: int) -> List[str]:
        api_key = self.settings.get("google_api_key", "")
        cse_id = self.settings.get("google_cse_id", "")
        if not api_key or not cse_id:
            raise ValueError("Google API 金鑰或 CSE ID 未設定。")

        params = {
            "key": api_key,
            "cx": cse_id,
            "q": f"{query} news",
            "num": max(1, min(num_results, 10)),
        }
        response = requests.get(self.api_url, params=params, timeout=15)
        self._raise_for_status(response)
        data = response.json()
        items = data.get("items", [])
        if not items:
            logger.warning("Google Search 沒有返回任何結果。")
        return [item.get("link") for item in items[:num_results] if item.get("link")]

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover - 直接拋出詳細錯誤
            content = exc.response.text if exc.response else ""
            raise requests.HTTPError(f"Google Search API 錯誤: {exc} | 內容: {content}")


class BingSearchProvider(SearchProvider):
    api_url = "https://api.bing.microsoft.com/v7.0/search"

    def search(self, query: str, num_results: int) -> List[str]:
        api_key = self.settings.get("bing_api_key", "")
        if not api_key:
            raise ValueError("Bing API 金鑰未設定。")

        headers = {"Ocp-Apim-Subscription-Key": api_key}
        params = {"q": f"{query} news", "count": max(1, min(num_results, 50))}
        response = requests.get(self.api_url, headers=headers, params=params, timeout=15)
        self._raise_for_status(response)
        data = response.json()
        web_pages = data.get("webPages", {}).get("value", [])
        if not web_pages:
            logger.warning("Bing Search 沒有返回任何結果。")
        return [item.get("url") for item in web_pages[:num_results] if item.get("url")]

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover - 直接拋出詳細錯誤
            content = exc.response.text if exc.response else ""
            raise requests.HTTPError(f"Bing Search API 錯誤: {exc} | 內容: {content}")


class DuckDuckGoSearchProvider(SearchProvider):
    base_url = "https://html.duckduckgo.com/html/"

    def __init__(self, settings: Dict[str, str]):
        super().__init__(settings)
        self.ua = UserAgent()

    def search(self, query: str, num_results: int) -> List[str]:
        headers = {"User-Agent": self.ua.random}
        params = {"q": f"{query} news"}
        response = requests.get(self.base_url, headers=headers, params=params, timeout=15)
        self._raise_for_status(response)
        soup = BeautifulSoup(response.text, "lxml")
        link_tags = soup.select("a.result__a")
        links: List[str] = []
        for tag in link_tags[:num_results]:
            href = tag.get("href")
            if not href:
                continue
            if href.startswith("//"):
                links.append("https:" + href)
            else:
                links.append(href)
        if not links:
            logger.warning("DuckDuckGo Search 沒有返回任何結果。")
        return links

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover - 直接拋出詳細錯誤
            content = exc.response.text if exc.response else ""
            raise requests.HTTPError(f"DuckDuckGo Search 錯誤: {exc} | 內容: {content}")


class SearchAggregator:
    """根據設定檔依序嘗試多個搜尋來源。"""

    def __init__(self, settings_path: Path):
        self.settings_path = settings_path
        self.settings = self._load_settings()
        self.providers = {
            "google": GoogleSearchProvider,
            "bing": BingSearchProvider,
            "duckduckgo": DuckDuckGoSearchProvider,
        }

    def _load_settings(self) -> Dict[str, str]:
        if not self.settings_path.exists():
            raise FileNotFoundError(f"設定檔不存在: {self.settings_path}")
        with self.settings_path.open("r", encoding="utf-8") as file:
            return json.load(file)

    def search(self, query: str, num_results: int) -> List[str]:
        search_sources = self.settings.get("search_sources", []) or []
        if not search_sources:
            raise ValueError("search_sources 配置為空，無法執行搜尋。")

        errors = []
        for source in search_sources:
            provider_class = self.providers.get(source.lower())
            if not provider_class:
                logger.warning(f"未知的搜尋來源: {source}")
                continue

            provider = provider_class(self.settings)
            try:
                logger.info(f"嘗試使用 {source} 進行搜尋...")
                results = provider.search(query, num_results)
                if results:
                    logger.info(f"使用 {source} 搜尋成功，取得 {len(results)} 筆結果。")
                    return results
                logger.warning(f"{source} 搜尋未取得結果，嘗試下一個來源。")
            except Exception as exc:
                logger.exception(f"{source} 搜尋失敗，嘗試下一個來源。原因: {exc}")
                errors.append(f"{source}: {exc}")
                continue

        raise RuntimeError(f"所有搜尋來源均失敗。詳細資訊: {'; '.join(errors)}")


def find_project_root(start_path: str, marker_files) -> Path:
    path = Path(start_path).resolve()
    for parent in [path] + list(path.parents):
        for marker in marker_files:
            if (parent / marker).exists():
                return parent
    return Path(start_path).resolve()


PROJECT_ROOT_MARKERS = {"package.json", ".git"}
project_root = find_project_root(os.path.abspath(__file__), PROJECT_ROOT_MARKERS)
log_path = project_root / "logs" / "plugin_newsScraper.log"
log_path.parent.mkdir(parents=True, exist_ok=True)
logger.add(log_path, rotation="10 MB", retention="7 days", level="INFO")

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_EXPIRATION = 86400
CACHE_DIR.mkdir(exist_ok=True)


class ResearcherStrategy:
    """Search Aggregator 版本。"""

    def __init__(self):
        self.aggregator = SearchAggregator(Path(__file__).parents[2] / "setting.json")
        logger.info("ResearcherStrategy (Aggregator) 已初始化。")

    async def discover_sources(self, topic: str, num_results: int = 5) -> ResearcherOutput:
        cache_key = hashlib.md5(topic.encode("utf-8")).hexdigest() + f"_n{num_results}.json"
        cache_file = CACHE_DIR / cache_key

        if cache_file.exists():
            cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
            if time.time() - cached_data.get("timestamp", 0) < CACHE_EXPIRATION:
                logger.info(f"從快取命中主題: {topic}")
                return ResearcherOutput.model_validate(cached_data["content"])

        try:
            logger.info(f"正在為主題 '{topic}' 執行聚合搜尋...")
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(None, lambda: self.aggregator.search(topic, num_results))
            result_obj = ResearcherResult(discovered_urls=results)
            output_obj = ResearcherOutput(success=True, result=result_obj)
            cache_content = {"timestamp": time.time(), "content": output_obj.model_dump()}
            cache_file.write_text(json.dumps(cache_content, ensure_ascii=False), encoding="utf-8")
            return output_obj
        except Exception as exc:
            error_message = f"ResearcherStrategy 搜尋失敗: {exc}"
            logger.exception(error_message)
            return ResearcherOutput(success=False, error=error_message)


def main():
    if len(sys.argv) > 2:
        try:
            topic = sys.argv[1]
            num_results = int(sys.argv[2])

            async def async_main():
                researcher = ResearcherStrategy()
                result_model = await researcher.discover_sources(topic, num_results=num_results)
                sys.stdout.buffer.write(result_model.model_dump_json().encode("utf-8"))

            asyncio.run(async_main())
        except Exception as exc:  # pragma: no cover - CLI 主流程錯誤處理
            error_output = ResearcherOutput(success=False, error=str(exc))
            sys.stdout.buffer.write(error_output.model_dump_json().encode("utf-8"))
    else:
        error_result = ResearcherOutput(success=False, error="Insufficient arguments.")
        sys.stdout.buffer.write(error_result.model_dump_json().encode("utf-8"))


if __name__ == "__main__":
    main()
