# src/plugins/newsScraper/strategies/local/evaluator.py
from __future__ import annotations

import re
from typing import Iterable, List, Set

from loguru import logger

from .data_models import EvaluationResult


class ContentEvaluator:
    """基於啟發式規則的內容評判器。"""

    def __init__(
        self,
        keyword_weight: float = 0.6,
        length_weight: float = 0.4,
        passing_threshold: float = 60,
    ) -> None:
        if keyword_weight < 0 or length_weight < 0:
            raise ValueError("權重不可為負數。")
        total_weight = keyword_weight + length_weight
        if total_weight == 0:
            raise ValueError("權重總和不可為 0。")

        self.keyword_weight = keyword_weight / total_weight
        self.length_weight = length_weight / total_weight
        self.passing_threshold = passing_threshold
        self.error_signatures = {"404 not found", "access denied", "forbidden"}
        self.stopwords = {
            "the",
            "and",
            "or",
            "of",
            "to",
            "a",
            "an",
            "in",
            "on",
            "for",
            "with",
            "is",
            "are",
            "was",
            "were",
        }

    def evaluate(self, content: str, query: str) -> EvaluationResult:
        """評估內容品質並回傳分數與原因。"""
        try:
            normalized_content = (content or "").strip()
            if not normalized_content or self._contains_error_signature(normalized_content):
                logger.debug("內容無效或包含錯誤訊息，直接給 0 分。")
                return EvaluationResult(score=0.0, is_passing=False, reason="Invalid content")

            reasons: List[str] = []
            length_score = 100.0
            if len(normalized_content) < 200:
                length_score = 50.0
                reasons.append("Content too short")
            logger.debug("內容長度: {}，長度分數: {}", len(normalized_content), length_score)

            keywords = self._extract_keywords(query)
            keyword_score = self._calculate_keyword_score(normalized_content, keywords)
            if keywords and keyword_score == 0:
                reasons.append("Keywords missing")

            score = (
                keyword_score * self.keyword_weight
                + length_score * self.length_weight
            )
            score = max(0.0, min(score, 100.0))
            is_passing = score >= self.passing_threshold
            reason = "; ".join(reasons) if reasons else "Content meets heuristic checks"

            logger.debug(
                "評分完成 - keyword_score: {} length_score: {} total_score: {} passing: {} reason: {}",
                keyword_score,
                length_score,
                score,
                is_passing,
                reason,
            )

            return EvaluationResult(score=score, is_passing=is_passing, reason=reason)
        except Exception as exc:  # pragma: no cover - 防禦性處理
            logger.exception("評分過程發生例外: {}", exc)
            return EvaluationResult(score=0.0, is_passing=False, reason="Evaluation error")

    def _contains_error_signature(self, content: str) -> bool:
        lowered = content.lower()
        return any(signature in lowered for signature in self.error_signatures)

    def _extract_keywords(self, query: str) -> List[str]:
        tokens = re.findall(r"\b\w+\b", (query or "").lower())
        keywords = [token for token in tokens if token not in self.stopwords]
        logger.debug("Query 轉換後關鍵字: {}", keywords)
        return keywords

    def _calculate_keyword_score(self, content: str, keywords: Iterable[str]) -> float:
        keyword_set: Set[str] = {keyword for keyword in keywords if keyword}
        if not keyword_set:
            logger.debug("Query 無關鍵字，關鍵字分數設為 0。")
            return 0.0

        lowered_content = content.lower()
        matched = sum(1 for keyword in keyword_set if keyword in lowered_content)
        coverage = matched / len(keyword_set)
        logger.debug("關鍵字覆蓋率: {} (matched: {}, total: {})", coverage, matched, len(keyword_set))
        return coverage * 100.0
