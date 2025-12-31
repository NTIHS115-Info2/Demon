# src/plugins/newsScraper/strategies/local/evaluator.py
import re
from typing import List

from loguru import logger

from .data_models import EvaluationResult


class ContentEvaluator:
    def __init__(self, keyword_weight: float = 0.6, length_weight: float = 0.4, threshold: float = 60.0):
        self.keyword_weight = keyword_weight
        self.length_weight = length_weight
        self.threshold = threshold
        self.stopwords = {"the", "and", "or", "of", "to", "in", "a", "an", "for", "on", "with"}
        self.invalid_markers = {"404 not found", "access denied", "forbidden", "not found", "error"}

    def evaluate(self, content: str, query: str) -> EvaluationResult:
        try:
            if not content or self._contains_invalid_marker(content):
                logger.debug("內容無效或包含錯誤標記，評分為 0。")
                return EvaluationResult(score=0.0, is_passing=False, reason="Invalid content")

            reasons: List[str] = []
            content_length = len(content)
            length_score = self._calculate_length_score(content_length, reasons)
            keyword_score = self._calculate_keyword_score(content, query, reasons)

            total_score = (keyword_score * self.keyword_weight) + (length_score * self.length_weight)
            if content_length < 200:
                total_score = max(0.0, total_score - 50.0)
            total_score = max(0.0, min(100.0, total_score))

            reason_text = " | ".join(reasons) if reasons else "Content evaluated"
            is_passing = total_score >= self.threshold
            logger.debug(
                "評分完成: score={score}, is_passing={is_passing}, reasons={reasons}",
                score=total_score,
                is_passing=is_passing,
                reasons=reason_text,
            )
            return EvaluationResult(score=total_score, is_passing=is_passing, reason=reason_text)
        except Exception as exc:
            logger.exception("評分時發生錯誤: {}", exc)
            return EvaluationResult(score=0.0, is_passing=False, reason="Evaluation error")

    def _contains_invalid_marker(self, content: str) -> bool:
        lowered = content.lower()
        return any(marker in lowered for marker in self.invalid_markers)

    def _calculate_length_score(self, content_length: int, reasons: List[str]) -> float:
        if content_length < 200:
            reasons.append("Content too short")
            return 10.0
        return min(100.0, (content_length / 2000.0) * 100.0)

    def _calculate_keyword_score(self, content: str, query: str, reasons: List[str]) -> float:
        keywords = [word for word in re.findall(r"\w+", query.lower()) if word not in self.stopwords]
        if not keywords:
            reasons.append("Keywords missing")
            return 0.0

        content_lower = content.lower()
        matched = sum(1 for word in keywords if word in content_lower)
        coverage = matched / len(keywords)
        if coverage < 0.3:
            reasons.append("Low keyword coverage")
        return coverage * 100.0
