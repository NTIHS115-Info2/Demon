# src/plugins/newsScraper/strategies/local/evaluator.py
from __future__ import annotations

import re
from typing import Iterable, List, Set

from loguru import logger
from pydantic import Field

from .data_models import EvaluationResult


class EvaluationResultExtended(EvaluationResult):
    reasons: List[str] = Field(default_factory=list)
    matched_keywords: List[str] = Field(default_factory=list)


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

    def evaluate(self, content: str, query: str) -> EvaluationResultExtended:
        """評估內容品質並回傳分數與原因。"""
        try:
            normalized_content = (content or "").strip()
            if not normalized_content or self._contains_error_signature(normalized_content):
                logger.debug("內容無效或包含錯誤訊息，直接給 0 分。")
                return EvaluationResultExtended(
                    score=0.0,
                    is_passing=False,
                    reason="Invalid content",
                    reasons=["invalid_content"],
                    matched_keywords=[],
                )

            reasons: List[str] = []
            length_score = self._calculate_length_score(len(normalized_content))
            if len(normalized_content) < 200:
                reasons.append("too_short")
            logger.debug("內容長度: {}，長度分數: {}", len(normalized_content), length_score)

            keywords = self._extract_keywords(query)
            keyword_score, matched_keywords, url_false_positive_filtered = (
                self._calculate_keyword_score(normalized_content, keywords)
            )
            if not matched_keywords and keywords:
                reasons.append("no_keyword_hit")
            if url_false_positive_filtered:
                reasons.append("url_false_positive_filtered")

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

            return EvaluationResultExtended(
                score=score,
                is_passing=is_passing,
                reason=reason,
                reasons=reasons,
                matched_keywords=matched_keywords,
            )
        except Exception as exc:  # pragma: no cover - 防禦性處理
            logger.exception("評分過程發生例外: {}", exc)
            return EvaluationResultExtended(
                score=0.0,
                is_passing=False,
                reason="Evaluation error",
                reasons=["evaluation_error"],
                matched_keywords=[],
            )

    def _contains_error_signature(self, content: str) -> bool:
        lowered = content.lower()
        return any(signature in lowered for signature in self.error_signatures)

    def _extract_keywords(self, query: str) -> List[str]:
        tokens = re.findall(r"[A-Za-z0-9#.+&]+|[\u0080-\uFFFF]+", (query or "").lower())
        keywords = [token for token in tokens if token and token not in self.stopwords]
        logger.debug("Query 轉換後關鍵字: {}", keywords)
        return keywords

    def _calculate_length_score(self, content_length: int) -> float:
        if content_length <= 0:
            return 0.0
        max_length = 500
        score = (content_length / max_length) * 100.0
        return max(5.0, min(score, 100.0))

    def _calculate_keyword_score(
        self,
        content: str,
        keywords: Iterable[str],
    ) -> tuple[float, List[str], bool]:
        keyword_set: Set[str] = {keyword for keyword in keywords if keyword}
        if not keyword_set:
            logger.debug("Query 無關鍵字，關鍵字分數設為 0。")
            return 0.0, [], False

        matched_keywords: List[str] = []
        url_false_positive_filtered = False
        lowered_content = content.lower()

        for keyword in keyword_set:
            match_type = self._classify_keyword(keyword)
            if match_type == "ascii_alnum":
                pattern = re.compile(
                    rf"(?<![A-Za-z0-9]){re.escape(keyword)}(?![A-Za-z0-9])",
                    flags=re.IGNORECASE,
                )
                if pattern.search(content):
                    matched_keywords.append(keyword)
            elif match_type == "cjk":
                if keyword.lower() in lowered_content:
                    matched_keywords.append(keyword)
            else:
                boundary = r"[\s\(\)\[\]\{\}<>\"'“”‘’.,;:!?/\\|`~\-_=+]"
                pattern = re.compile(
                    rf"(^|{boundary}){re.escape(keyword)}($|{boundary})",
                    flags=re.IGNORECASE,
                )
                match = pattern.search(content)
                if match:
                    keyword_start = match.start(0) + len(match.group(1) or "")
                    if keyword.startswith(".") and self._is_url_false_positive(content, keyword_start):
                        url_false_positive_filtered = True
                        continue
                    matched_keywords.append(keyword)

        coverage = len(matched_keywords) / len(keyword_set)
        logger.debug(
            "關鍵字覆蓋率: {} (matched: {}, total: {})",
            coverage,
            len(matched_keywords),
            len(keyword_set),
        )
        return coverage * 100.0, matched_keywords, url_false_positive_filtered

    @staticmethod
    def _classify_keyword(keyword: str) -> str:
        if any(ord(char) > 127 for char in keyword):
            return "cjk"
        if keyword.isalnum():
            return "ascii_alnum"
        return "symbolic"

    @staticmethod
    def _is_url_false_positive(content: str, match_start: int) -> bool:
        lowered = content.lower()
        if match_start > 0 and re.search(r"[a-z0-9-]$", lowered[match_start - 1]):
            return True
        prefix = lowered[max(0, match_start - 20):match_start]
        if "http://" in prefix or "https://" in prefix or "www." in prefix or "://" in prefix:
            return True
        return False
