# src/plugins/newsScraper/strategies/local/refiner.py
from __future__ import annotations

import re
from typing import List

from loguru import logger


class QueryRefiner:
    """依據評分原因調整查詢關鍵字。"""

    def __init__(self) -> None:
        logger.debug("初始化 QueryRefiner")

    def refine_query(self, original_query: str, reason: str, attempt: int) -> str:
        """根據評分失敗原因，產生新的查詢字串。"""
        safe_query = (original_query or "").strip()
        safe_reason = (reason or "").strip()

        if not safe_query:
            logger.debug("原始查詢為空，無法修正。")
            return original_query

        new_query = safe_query
        lowered_reason = safe_reason.lower()

        if "keywords" in lowered_reason:
            new_query = self._broaden_query(new_query)
        elif "short" in lowered_reason or "invalid" in lowered_reason:
            new_query = self._reinforce_intent(new_query, attempt)

        if attempt > 2:
            new_query = self._truncate_query(new_query)

        if not new_query:
            new_query = safe_query

        logger.debug(
            "Refining query: '{}' -> '{}' due to '{}'",
            safe_query,
            new_query,
            safe_reason,
        )
        return new_query

    def _broaden_query(self, query: str) -> str:
        cleaned = query.replace("\"", "").replace("'", "")
        tokens = self._tokenize(cleaned)
        modifiers = {"latest", "recent", "best"}
        filtered = [token for token in tokens if len(token) > 3 and token not in modifiers]
        return " ".join(filtered) if filtered else cleaned.strip()

    def _reinforce_intent(self, query: str, attempt: int) -> str:
        suffixes = ["news", "summary", "report"]
        suffix = suffixes[(attempt - 1) % len(suffixes)]
        if query.lower().endswith(tuple(suffixes)):
            return query
        return f"{query} {suffix}".strip()

    def _truncate_query(self, query: str) -> str:
        tokens = self._tokenize(query)
        return " ".join(tokens[:3]) if tokens else query

    @staticmethod
    def _tokenize(query: str) -> List[str]:
        return re.findall(r"\b\w+\b", query.lower())
