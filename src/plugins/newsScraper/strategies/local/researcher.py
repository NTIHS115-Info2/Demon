# src/plugins/newsScraper/strategies/local/researcher.py
import asyncio
import hashlib
import json
import os
import sys
import time
from abc import ABC, abstractmethod
from collections import Counter
from math import inf
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

import requests
from loguru import logger
from tavily import TavilyClient

from .data_models import ResearcherOutput, ResearcherResult, SearchItem
from .evaluator import ContentEvaluator, EvaluationResultExtended
from .refiner import QueryRefiner


class SearchProvider(ABC):
    """抽象搜尋供應商。"""

    def __init__(self, settings: Dict[str, str]):
        self.settings = settings

    @abstractmethod
    def search(self, query: str, num_results: int) -> List[SearchItem]:
        """執行搜尋並回傳 URL 清單。"""


class GoogleSearchProvider(SearchProvider):
    api_url = "https://www.googleapis.com/customsearch/v1"

    def search(self, query: str, num_results: int) -> List[SearchItem]:
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
        results: List[SearchItem] = []
        for item in items[:num_results]:
            url = item.get("link")
            if not url:
                continue
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            try:
                results.append(SearchItem(url=url, title=title, snippet=snippet))
            except ValueError as exc:
                logger.debug("跳過無效 URL: {}", exc)
        return results

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover - 直接拋出詳細錯誤
            content = exc.response.text if exc.response else ""
            raise requests.HTTPError(f"Google Search API 錯誤: {exc} | 內容: {content}")


class BingSearchProvider(SearchProvider):
    api_url = "https://api.bing.microsoft.com/v7.0/search"

    def search(self, query: str, num_results: int) -> List[SearchItem]:
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
        results: List[SearchItem] = []
        for item in web_pages[:num_results]:
            url = item.get("url")
            if not url:
                continue
            title = item.get("name", "")
            snippet = item.get("snippet") or item.get("description") or ""
            try:
                results.append(SearchItem(url=url, title=title, snippet=snippet))
            except ValueError as exc:
                logger.debug("跳過無效 URL: {}", exc)
        return results

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover - 直接拋出詳細錯誤
            content = exc.response.text if exc.response else ""
            raise requests.HTTPError(f"Bing Search API 錯誤: {exc} | 內容: {content}")


class TavilySearchProvider(SearchProvider):
    def search(self, query: str, num_results: int) -> List[SearchItem]:
        api_key = self.settings.get("tavily_api_key", "")
        if not api_key:
            raise ValueError("Tavily API 金鑰未設定。")

        client = TavilyClient(api_key=api_key)
        response = client.search(
            query=query,
            max_results=max(1, min(num_results, 20)),
            search_depth="basic",
            include_answer=False,
            include_raw_content=False,
            include_images=False,
        )
        results = response.get("results", [])
        if not results:
            logger.warning("Tavily Search 沒有返回任何結果。")
        items: List[SearchItem] = []
        for result in results[:num_results]:
            url = result.get("url")
            if not url:
                continue
            title = result.get("title", "")
            snippet = result.get("content") or result.get("snippet") or ""
            try:
                items.append(SearchItem(url=url, title=title, snippet=snippet))
            except ValueError as exc:
                logger.debug("跳過無效 URL: {}", exc)
        return items


class SearXNGSearchProvider(SearchProvider):
    def search(self, query: str, num_results: int) -> List[SearchItem]:
        base_url = self.settings.get("searxng_base_url", "http://localhost:8080").rstrip("/")
        search_url = f"{base_url}/search"
        params = {"q": f"{query} news", "format": "json"}
        try:
            response = requests.get(search_url, params=params, timeout=15)
            self._raise_for_status(response)
        except requests.ConnectionError as exc:
            logger.warning("SearXNG 連線失敗，請確認 Docker 是否啟動: {}", exc)
            return []
        data = response.json()
        results = data.get("results", [])
        if not results:
            logger.warning("SearXNG Search 沒有返回任何結果。")
        items: List[SearchItem] = []
        for result in results[:num_results]:
            url = result.get("url")
            if not url:
                continue
            title = result.get("title", "")
            snippet = result.get("content") or result.get("snippet") or ""
            try:
                items.append(SearchItem(url=url, title=title, snippet=snippet))
            except ValueError as exc:
                logger.debug("跳過無效 URL: {}", exc)
        return items

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover - 直接拋出詳細錯誤
            content = exc.response.text if exc.response else ""
            raise requests.HTTPError(f"SearXNG Search 錯誤: {exc} | 內容: {content}")


class SearchAggregator:
    """根據設定檔依序嘗試多個搜尋來源。"""

    DEFAULT_SEARCH_PRIORITY = ["tavily", "google", "bing", "searxng"]

    def __init__(self, settings_path: Path):
        self.settings_source_path = self._resolve_settings_path(settings_path)
        self.settings = self._load_settings()
        self.providers = {
            "tavily": TavilySearchProvider,
            "google": GoogleSearchProvider,
            "bing": BingSearchProvider,
            "searxng": SearXNGSearchProvider,
        }

    def _resolve_settings_path(self, settings_path: Path) -> Path:
        local_path = settings_path.with_name("setting.local.json")
        if local_path.exists():
            logger.info(f"偵測到本地設定檔，將使用: {local_path}")
            return local_path
        logger.info(f"未找到本地設定檔，使用預設設定檔: {settings_path}")
        return settings_path

    def _load_settings(self) -> Dict[str, str]:
        if not self.settings_source_path.exists():
            raise FileNotFoundError(f"設定檔不存在: {self.settings_source_path}")
        with self.settings_source_path.open("r", encoding="utf-8") as file:
            settings = json.load(file)
        defaults = {
            "tavily_api_key": "",
            "bing_api_key": "",
            "searxng_base_url": "http://localhost:8080",
            "search_priority": list(self.DEFAULT_SEARCH_PRIORITY),
        }
        for key, value in defaults.items():
            if settings.get(key) is None:
                settings[key] = value
        return settings

    def search(self, query: str, num_results: int) -> List[SearchItem]:
        search_sources = self.settings.get("search_priority") or self.settings.get("search_sources")
        if not isinstance(search_sources, list) or not search_sources:
            search_sources = list(self.DEFAULT_SEARCH_PRIORITY)

        errors = []
        for source in search_sources:
            provider_class = self.providers.get(source.lower())
            if not provider_class:
                logger.warning(f"未知的搜尋來源: {source}")
                continue
            if not self._has_required_keys(source.lower()):
                logger.info("跳過 %s，因為缺少必要的 API 金鑰設定。", source)
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

    def _has_required_keys(self, source: str) -> bool:
        if source == "google":
            return bool(self.settings.get("google_api_key")) and bool(
                self.settings.get("google_cse_id")
            )
        if source == "bing":
            return bool(self.settings.get("bing_api_key"))
        if source == "tavily":
            return bool(self.settings.get("tavily_api_key"))
        if source == "searxng":
            return True
        return False


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
        self.evaluator = ContentEvaluator()
        self.refiner = QueryRefiner()
        logger.info("ResearcherStrategy (Aggregator) 已初始化。")

    async def discover_sources(self, topic: str, num_results: int = 5) -> ResearcherOutput:
        cache_key = hashlib.md5(topic.encode("utf-8")).hexdigest() + f"_n{num_results}.json"
        cache_file = CACHE_DIR / cache_key

        if cache_file.exists():
            cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
            if time.time() - cached_data.get("timestamp", 0) < CACHE_EXPIRATION:
                logger.info(f"從快取命中主題: {topic}")
                return ResearcherOutput.model_validate(cached_data["content"])

        current_query = topic
        previous_queries = {self._normalize_query(topic)}
        best_attempt_results: Optional[Tuple[List[SearchItem], List[SearchItem]]] = None
        best_attempt_score = -inf
        best_attempt_valid_count = 0
        best_attempt_query = current_query
        max_retries = 3
        last_best_score: Optional[float] = None
        no_improvement_count = 0
        stop_reason = "max_retries"
        query_keywords = self.evaluator._extract_keywords((topic or "").casefold())

        try:
            logger.info(f"正在為主題 '{topic}' 執行聚合搜尋...")
            loop = asyncio.get_event_loop()
            for attempt in range(max_retries):
                results = await loop.run_in_executor(
                    None,
                    lambda: self.aggregator.search(current_query, num_results),
                )
                valid_items: List[SearchItem] = []
                invalid_items: List[SearchItem] = []
                evaluation_records: List[Tuple[SearchItem, EvaluationResultExtended]] = []
                reasons_counter: Counter[str] = Counter()
                missing_keywords_counter: Counter[str] = Counter()
                false_hit_examples: List[Dict[str, str]] = []
                attempt_best_score = -inf

                for item in results:
                    content_to_eval = self._compose_content(item.title, item.snippet)
                    evaluation = self.evaluator.evaluate(content_to_eval, topic)
                    evaluation_records.append((item, evaluation))
                    attempt_best_score = max(attempt_best_score, evaluation.score)
                    if evaluation.is_passing:
                        valid_items.append(item)
                    else:
                        invalid_items.append(item)
                    for reason in evaluation.reasons:
                        reasons_counter[reason] += 1
                    missing = [kw for kw in query_keywords if kw not in evaluation.matched_keywords]
                    for keyword in missing:
                        missing_keywords_counter[keyword] += 1
                    if "url_false_positive_filtered" in evaluation.reasons:
                        false_hit_examples.append(
                            {
                                "url": item.url,
                                "title": item.title,
                            }
                        )

                attempt_valid_count = len(valid_items)
                logger.info(
                    "Attempt %s | query='%s' results=%s valid=%s best_score=%.2f",
                    attempt + 1,
                    current_query,
                    len(results),
                    attempt_valid_count,
                    0.0 if attempt_best_score == -inf else attempt_best_score,
                )
                self._log_top_items(evaluation_records)

                if (
                    attempt_valid_count > best_attempt_valid_count
                    or attempt_best_score > best_attempt_score
                ):
                    best_attempt_results = (valid_items, invalid_items)
                    best_attempt_score = attempt_best_score
                    best_attempt_valid_count = attempt_valid_count
                    best_attempt_query = current_query

                if attempt_valid_count >= 1:
                    ordered_results = valid_items + invalid_items
                    result_obj = ResearcherResult(items=ordered_results)
                    output_obj = ResearcherOutput(success=True, result=result_obj)
                    cache_content = {"timestamp": time.time(), "content": output_obj.model_dump()}
                    cache_file.write_text(json.dumps(cache_content, ensure_ascii=False), encoding="utf-8")
                    logger.info(
                        "搜尋成功，valid=%s top_score=%.2f query='%s'",
                        attempt_valid_count,
                        attempt_best_score,
                        current_query,
                    )
                    return output_obj

                fail_summary = self._build_fail_summary(
                    current_query,
                    attempt + 1,
                    attempt_best_score,
                    reasons_counter,
                    missing_keywords_counter,
                    false_hit_examples,
                    evaluation_records,
                )

                new_query = self.refiner.refine_query(current_query, fail_summary, attempt + 1)

                if last_best_score is not None and attempt_best_score <= last_best_score:
                    no_improvement_count += 1
                else:
                    no_improvement_count = 0
                last_best_score = attempt_best_score

                normalized_new_query = self._normalize_query(new_query)
                if normalized_new_query in previous_queries:
                    stop_reason = "duplicate_query"
                    break
                if no_improvement_count >= 2:
                    stop_reason = "no_improvement"
                    break

                previous_queries.add(normalized_new_query)
                current_query = new_query

            if best_attempt_results:
                valid_items, invalid_items = best_attempt_results
                ordered_results = valid_items + invalid_items
                result_obj = ResearcherResult(items=ordered_results)
                output_obj = ResearcherOutput(success=True, result=result_obj)
                cache_content = {"timestamp": time.time(), "content": output_obj.model_dump()}
                cache_file.write_text(json.dumps(cache_content, ensure_ascii=False), encoding="utf-8")
                logger.info(
                    "搜尋停止 (%s)，回退 best_attempt query='%s' score=%.2f",
                    stop_reason,
                    best_attempt_query,
                    best_attempt_score,
                )
                return output_obj

            logger.warning("搜尋停止 (%s)，無可用結果。", stop_reason)
            return ResearcherOutput(success=False, error=f"Search stopped: {stop_reason}")
        except Exception as exc:
            error_message = f"ResearcherStrategy 搜尋失敗: {exc}"
            logger.exception(error_message)
            return ResearcherOutput(success=False, error=error_message)

    @staticmethod
    def _normalize_query(query: str) -> str:
        return (query or "").casefold().strip()

    @staticmethod
    def _compose_content(title: str, snippet: str) -> str:
        return "\n".join(part for part in [title, snippet] if part).strip()

    @staticmethod
    def _build_fail_summary(
        query: str,
        attempt: int,
        best_score: float,
        reasons_counter: Counter[str],
        missing_keywords_counter: Counter[str],
        false_hit_examples: Sequence[Dict[str, str]],
        evaluation_records: Sequence[Tuple[SearchItem, EvaluationResultExtended]],
    ) -> str:
        top_reasons = reasons_counter.most_common(3)
        top_missed_keywords = [kw for kw, _ in missing_keywords_counter.most_common(5)]
        best_item = max(evaluation_records, key=lambda record: record[1].score, default=(None, None))
        best_item_score = best_item[1].score if best_item[1] else 0.0
        best_item_reasons = best_item[1].reasons if best_item[1] else []
        summary = {
            "query": query,
            "attempt": attempt,
            "valid_count": 0,
            "top_reasons": dict(top_reasons),
            "top_missed_keywords": top_missed_keywords,
            "false_hit_examples": list(false_hit_examples)[:3],
            "best_attempt_stats": {
                "best_score": best_score if best_score != -inf else 0.0,
                "best_item_score": best_item_score,
                "best_item_reasons": best_item_reasons,
            },
        }
        return json.dumps(summary, ensure_ascii=False)

    @staticmethod
    def _log_top_items(evaluation_records: Sequence[Tuple[SearchItem, EvaluationResultExtended]]) -> None:
        top_items = sorted(
            evaluation_records,
            key=lambda record: record[1].score,
            reverse=True,
        )[:5]
        for item, evaluation in top_items:
            domain = urlparse(item.url).netloc if item.url else ""
            title = (item.title or "")[:80]
            logger.debug(
                "Top item score=%.2f passing=%s domain=%s title=%s",
                evaluation.score,
                evaluation.is_passing,
                domain,
                title,
            )


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
    if len(sys.argv) == 1:
        try:
            normalized_item = SearchItem(
                url="https://example.com/news?utm_source=test&foo=bar"
            )
            print("URL Normalize:", normalized_item.url)
        except Exception as exc:
            print("URL Normalize: FAIL", exc)

        try:
            SearchItem(url="https:///invalid")
            print("URL Invalid Netloc: FAIL")
        except Exception:
            print("URL Invalid Netloc: OK")

        evaluator = ContentEvaluator()
        result = evaluator.evaluate("https://example.net", ".NET")
        print("Evaluator .NET URL false positive:", result.matched_keywords, result.reasons)
    else:
        main()
