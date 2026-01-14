# src/plugins/newsScraper/strategies/local/researcher.py
import asyncio
import hashlib
import json
import os
import random
import sys
import tempfile
import time
from datetime import timezone
from email.utils import parsedate_to_datetime
from abc import ABC, abstractmethod
from collections import Counter
from enum import Enum
from math import inf
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

import requests
from fake_useragent import UserAgent
from filelock import FileLock
from loguru import logger
from pydantic import BaseModel, Field, ValidationError, field_validator
from tavily import TavilyClient

from .data_models import ResearcherOutput, ResearcherResult, SearchItem
from .evaluator import ContentEvaluator, EvaluationResultExtended
from .refiner import QueryRefiner


class SearchProvider(ABC):
    """抽象搜尋供應商。"""

    RATE_LIMIT_PENALTY_SECONDS = 30.0

    def __init__(self, settings: Dict[str, str], dispatcher: "BionicDispatcher", user_agent: UserAgent):
        self.settings = settings
        self.dispatcher = dispatcher
        self.user_agent = user_agent

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
        headers = {"User-Agent": self.user_agent.random}
        response = requests.get(self.api_url, params=params, headers=headers, timeout=15)
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

    def _raise_for_status(self, response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover - 直接拋出詳細錯誤
            if response.status_code in (403, 429):
                self.dispatcher.apply_penalty(self.RATE_LIMIT_PENALTY_SECONDS)
            content = exc.response.text if exc.response else ""
            raise requests.HTTPError(f"Google Search API 錯誤: {exc} | 內容: {content}")


class TavilySearchProvider(SearchProvider):
    def search(self, query: str, num_results: int) -> List[SearchItem]:
        api_key = self.settings.get("tavily_api_key", "")
        if not api_key:
            raise ValueError("Tavily API 金鑰未設定。")

        client = TavilyClient(api_key=api_key)
        try:
            response = client.search(
                query=query,
                max_results=max(1, min(num_results, 20)),
                search_depth="basic",
                include_answer=False,
                include_raw_content=False,
                include_images=False,
            )
        except Exception as exc:
            status_code = getattr(exc, "status_code", None)
            response = getattr(exc, "response", None)
            if status_code is None and response is not None:
                status_code = getattr(response, "status_code", None)
            if status_code in (403, 429):
                self.dispatcher.apply_penalty(self.RATE_LIMIT_PENALTY_SECONDS)
            else:
                error_name = exc.__class__.__name__
                error_text = str(exc)
                if "UsageLimitExceeded" in error_name or "429" in error_text:
                    self.dispatcher.apply_penalty(self.RATE_LIMIT_PENALTY_SECONDS)
            raise
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
    RATE_LIMIT_HINTS = ("rate limit", "too many requests", "429", "forbidden", "blocked")

    def search(self, query: str, num_results: int) -> List[SearchItem]:
        base_url = self.settings.get("searxng_base_url", "http://localhost:8080").rstrip("/")
        search_url = f"{base_url}/search"
        params = {"q": f"{query} news", "format": "json"}
        try:
            headers = {"User-Agent": self.user_agent.random}
            response = requests.get(search_url, params=params, headers=headers, timeout=15)
        except requests.ConnectionError as exc:
            logger.warning("SearXNG 連線失敗，請確認 Docker 是否啟動: {}", exc)
            return []
        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("SearXNG 回應非 JSON 格式，無法解析: {}", exc)
            if response.status_code >= 400:
                self._raise_for_status(response)
            return []
        has_rate_limit_signal = self._has_rate_limit_signal(data)
        if has_rate_limit_signal:
            self.dispatcher.apply_penalty(self.RATE_LIMIT_PENALTY_SECONDS)
            logger.warning("SearXNG 回應包含限流或封鎖訊號，已觸發冷卻。")
        results = data.get("results", [])
        if results:
            if response.status_code >= 400:
                self._apply_rate_limit_penalty(response)
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
        if response.status_code >= 400:
            self._raise_for_status(response)
        if not results:
            logger.warning("SearXNG Search 沒有返回任何結果。")
        return []

    def _raise_for_status(self, response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:  # pragma: no cover - 直接拋出詳細錯誤
            self._apply_rate_limit_penalty(response)
            content = exc.response.text if exc.response else ""
            raise requests.HTTPError(f"SearXNG Search 錯誤: {exc} | 內容: {content}")

    def _apply_rate_limit_penalty(self, response: requests.Response) -> None:
        if response.status_code in (403, 429):
            retry_after = self._parse_retry_after(response)
            penalty = max(self.RATE_LIMIT_PENALTY_SECONDS, retry_after or 0.0)
            self.dispatcher.apply_penalty(penalty)

    def _parse_retry_after(self, response: requests.Response) -> Optional[float]:
        retry_after = response.headers.get("Retry-After")
        if not retry_after:
            return None
        try:
            return float(retry_after)
        except ValueError:
            try:
                retry_time = parsedate_to_datetime(retry_after)
            except (TypeError, ValueError):
                return None
            now = time.time()
            if retry_time.tzinfo is None:
                retry_time = retry_time.replace(tzinfo=timezone.utc)
            return max(0.0, retry_time.timestamp() - now)

    def _has_rate_limit_signal(self, payload: Dict[str, object]) -> bool:
        errors = payload.get("errors")
        if isinstance(errors, list):
            for error in errors:
                if self._contains_rate_limit_hint(str(error)):
                    return True
        unresponsive = payload.get("unresponsive_engines")
        if isinstance(unresponsive, list):
            for engine in unresponsive:
                if self._contains_rate_limit_hint(str(engine)):
                    return True
        if isinstance(payload.get("error"), str) and self._contains_rate_limit_hint(
            payload.get("error", "")
        ):
            return True
        return False

    def _contains_rate_limit_hint(self, message: str) -> bool:
        lowered = message.lower()
        return any(hint in lowered for hint in self.RATE_LIMIT_HINTS)


class BionicDispatcher:
    """跨進程持久化仿生調度器。"""

    def __init__(
        self,
        state_path: Path,
        lock_path: Path,
        cooldown_seconds: float,
        penalty_seconds: float,
    ):
        self.state_path = state_path
        self.lock_path = lock_path
        self.cooldown_seconds = cooldown_seconds
        self.penalty_seconds = penalty_seconds
        self._lock = FileLock(str(self.lock_path))

    def wait_for_cooldown(self, cooldown_seconds: Optional[float] = None) -> None:
        cooldown = self.cooldown_seconds if cooldown_seconds is None else cooldown_seconds
        with self._lock:
            next_allowed = self._read_timestamp()
            now = time.time()
            wait_seconds = max(0.0, next_allowed - now)
            if wait_seconds > 0:
                time.sleep(wait_seconds)
            now = time.time()
            self._write_timestamp(now + cooldown)

    def apply_penalty(self, penalty_seconds: Optional[float] = None) -> None:
        penalty = penalty_seconds if penalty_seconds is not None else self.penalty_seconds
        with self._lock:
            next_allowed = max(self._read_timestamp(), time.time() + penalty)
            self._write_timestamp(next_allowed)

    def _read_timestamp(self) -> float:
        if not self.state_path.exists():
            return 0.0
        content = self.state_path.read_text(encoding="utf-8").strip()
        if not content:
            return 0.0
        try:
            return float(content)
        except ValueError:
            return 0.0

    def _write_timestamp(self, timestamp: float) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(f"{timestamp:.6f}", encoding="utf-8")


class SearchAggregator:
    """根據設定檔依序嘗試多個搜尋來源。"""

    DEFAULT_SEARCH_PRIORITY = ["tavily", "google", "searxng"]
    REQUEST_JITTER_MIN_SECONDS = 1.0
    REQUEST_JITTER_MAX_SECONDS = 3.0
    FAILURE_COOLDOWN_SECONDS = 2.0
    BIONIC_COOLDOWN_SECONDS = 2.0
    SEARXNG_COOLDOWN_SECONDS = 5.0
    RATE_LIMIT_PENALTY_SECONDS = 30.0
    TRACE_ENV_VAR = "BIONIC_TRACE"
    TRACE_PREFIX = "BIONIC_REQUEST_TS"

    def __init__(self, settings_path: Path):
        self.settings_source_path = self._resolve_settings_path(settings_path)
        self.settings = self._load_settings()
        cache_root = Path(os.environ.get("NEWS_SCRAPER_CACHE_DIR") or tempfile.gettempdir())
        project_id = Path(__file__).resolve().parents[2].name
        self.searxng_cooldown_seconds = self._resolve_searxng_cooldown()
        self.dispatcher = BionicDispatcher(
            state_path=cache_root / f".bionic_state_{project_id}",
            lock_path=cache_root / f".bionic_lock_{project_id}",
            cooldown_seconds=self.BIONIC_COOLDOWN_SECONDS,
            penalty_seconds=self.RATE_LIMIT_PENALTY_SECONDS,
        )
        self.user_agent = UserAgent()
        self.providers = {
            "tavily": TavilySearchProvider,
            "google": GoogleSearchProvider,
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
            "searxng_base_url": "http://localhost:8080",
            "searxng_cooldown_seconds": self.SEARXNG_COOLDOWN_SECONDS,
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

            provider = provider_class(self.settings, self.dispatcher, self.user_agent)
            try:
                logger.info(f"嘗試使用 {source} 進行搜尋...")
                self.dispatcher.wait_for_cooldown(self._get_cooldown_for_source(source.lower()))
                time.sleep(
                    random.uniform(
                        self.REQUEST_JITTER_MIN_SECONDS, self.REQUEST_JITTER_MAX_SECONDS
                    )
                )
                self._emit_trace()
                results = provider.search(query, num_results)
                if results:
                    logger.info(f"使用 {source} 搜尋成功，取得 {len(results)} 筆結果。")
                    return results
                logger.warning(f"{source} 搜尋未取得結果，嘗試下一個來源。")
                time.sleep(self.FAILURE_COOLDOWN_SECONDS)
            except Exception as exc:
                logger.exception(f"{source} 搜尋失敗，嘗試下一個來源。原因: {exc}")
                errors.append(f"{source}: {exc}")
                time.sleep(self.FAILURE_COOLDOWN_SECONDS)
                continue

        raise RuntimeError(f"所有搜尋來源均失敗。詳細資訊: {'; '.join(errors)}")

    def _has_required_keys(self, source: str) -> bool:
        if source == "google":
            return bool(self.settings.get("google_api_key")) and bool(
                self.settings.get("google_cse_id")
            )
        if source == "tavily":
            return bool(self.settings.get("tavily_api_key"))
        if source == "searxng":
            return True
        return False

    def _resolve_searxng_cooldown(self) -> float:
        env_value = os.environ.get("SEARXNG_COOLDOWN_SECONDS")
        if env_value:
            try:
                return max(0.0, float(env_value))
            except ValueError:
                logger.warning("SEARXNG_COOLDOWN_SECONDS 無效，將使用設定檔值。")
        value = self.settings.get("searxng_cooldown_seconds", self.SEARXNG_COOLDOWN_SECONDS)
        try:
            return max(0.0, float(value))
        except (TypeError, ValueError):
            return self.SEARXNG_COOLDOWN_SECONDS

    def _get_cooldown_for_source(self, source: str) -> float:
        if source == "searxng":
            return self.searxng_cooldown_seconds
        return self.BIONIC_COOLDOWN_SECONDS

    def _emit_trace(self) -> None:
        if os.environ.get(self.TRACE_ENV_VAR) == "1":
            timestamp = time.time()
            print(f"{self.TRACE_PREFIX} {timestamp:.6f}", file=sys.stderr, flush=True)


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


class ResearcherInput(BaseModel):
    class DetailLevel(str, Enum):
        CONCISE = "concise"
        QUICK = "quick"
        NORMAL = "normal"
        DEEP_DIVE = "deep_dive"

    topic: str = Field(..., max_length=200)
    query: str = Field("", max_length=200)
    keywords: List[str] = Field(default_factory=list)
    detail_level: DetailLevel = DetailLevel.NORMAL  # normal, deep_dive, quick

    @field_validator("detail_level", mode="before")
    @classmethod
    def normalize_detail_level(cls, value):
        if isinstance(value, ResearcherInput.DetailLevel):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in ResearcherInput.DetailLevel._value2member_map_:
                return ResearcherInput.DetailLevel(normalized)
            if normalized == "concise":
                return ResearcherInput.DetailLevel.CONCISE
        return ResearcherInput.DetailLevel.NORMAL

    @field_validator("topic", mode="before")
    @classmethod
    def validate_topic(cls, value):
        if value is None:
            raise ValueError("Topic cannot be empty")
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                raise ValueError("Topic cannot be empty")
            return stripped
        return value

    @field_validator("query", mode="before")
    @classmethod
    def normalize_query(cls, value):
        if value is None:
            return ""
        if isinstance(value, str):
            stripped = value.strip()
            return stripped if stripped else ""
        return value

    @field_validator("keywords", mode="before")
    @classmethod
    def normalize_keywords(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            stripped = value.strip()
            return [stripped] if stripped else []
        if isinstance(value, list):
            return [item.strip() for item in value if isinstance(item, str) and item.strip()]
        return []


class ResearcherStrategy:
    """Search Aggregator 版本。"""

    REFINEMENT_PAUSE_MIN_SECONDS = 2.0
    REFINEMENT_PAUSE_MAX_SECONDS = 4.0

    def __init__(self):
        self.aggregator = SearchAggregator(Path(__file__).parents[2] / "setting.json")
        self.evaluator = ContentEvaluator()
        self.refiner = QueryRefiner()
        logger.info("ResearcherStrategy (Aggregator) 已初始化。")

    async def discover_sources(
        self,
        topic: str,
        num_results: int = 5,
        max_iterations: int = 3,
        initial_query: Optional[str] = None,
    ) -> ResearcherOutput:
        cache_seed = f"{topic}:{initial_query or ''}:{num_results}:{max_iterations}"
        cache_key = hashlib.md5(cache_seed.encode("utf-8")).hexdigest() + f"_n{num_results}.json"
        cache_file = CACHE_DIR / cache_key

        if cache_file.exists():
            cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
            if time.time() - cached_data.get("timestamp", 0) < CACHE_EXPIRATION:
                logger.info(f"從快取命中主題: {topic}")
                return ResearcherOutput.model_validate(cached_data["content"])

        current_query = initial_query or topic
        previous_queries = {self._normalize_query(current_query)}
        best_attempt_results: Optional[Tuple[List[SearchItem], List[SearchItem]]] = None
        best_attempt_score = -inf
        best_attempt_valid_count = 0
        best_attempt_query = current_query
        last_best_score: Optional[float] = None
        no_improvement_count = 0
        stop_reason = "max_iterations"
        query_keywords = self.evaluator._extract_keywords((topic or "").casefold())

        try:
            logger.info(f"正在為主題 '{topic}' 執行聚合搜尋...")
            loop = asyncio.get_event_loop()
            attempt = 0
            while attempt < max_iterations:
                attempt += 1
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
                    attempt,
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
                    attempt,
                    attempt_best_score,
                    reasons_counter,
                    missing_keywords_counter,
                    false_hit_examples,
                    evaluation_records,
                )

                new_query = self.refiner.refine_query(current_query, fail_summary, attempt)
                time.sleep(
                    random.uniform(
                        self.REFINEMENT_PAUSE_MIN_SECONDS,
                        self.REFINEMENT_PAUSE_MAX_SECONDS,
                    )
                )

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
    if len(sys.argv) == 2:
        try:
            payload = json.loads(sys.argv[1])
            input_model = ResearcherInput.model_validate(payload)
            detail_level = input_model.detail_level.value
            if detail_level in (
                ResearcherInput.DetailLevel.QUICK.value,
                ResearcherInput.DetailLevel.CONCISE.value,
            ):
                num_results = 3
                max_iterations = 1
            elif detail_level == ResearcherInput.DetailLevel.DEEP_DIVE.value:
                num_results = 10
                max_iterations = 3
            else:
                num_results = 5
                max_iterations = 2
            keyword_query = " ".join(input_model.keywords) if input_model.keywords else ""
            initial_query = keyword_query or input_model.query or input_model.topic

            async def async_main():
                researcher = ResearcherStrategy()
                result_model = await researcher.discover_sources(
                    input_model.topic,
                    num_results=num_results,
                    max_iterations=max_iterations,
                    initial_query=initial_query,
                )
                sys.stdout.buffer.write(result_model.model_dump_json().encode("utf-8"))

            asyncio.run(async_main())
        except (json.JSONDecodeError, ValidationError) as exc:
            error_output = ResearcherOutput(success=False, error=f"Invalid input: {exc}")
            sys.stdout.buffer.write(error_output.model_dump_json().encode("utf-8"))
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
