# src/plugins/newsScraper/strategies/local/refiner.py
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import List, Optional, Sequence

from loguru import logger


class QueryRefiner:
    """依據評分原因調整查詢關鍵字。"""

    def __init__(self) -> None:
        logger.debug("初始化 QueryRefiner")
        self._synonym_mode = "unidirectional"
        self._synonyms: dict[str, list[str]] = {}
        self._load_synonyms()

    def refine_query(
        self,
        original_query: str,
        reason: str,
        attempt: int,
        history: Optional[Sequence[str]] = None,
    ) -> str:
        """根據評分失敗原因，產生新的查詢字串。"""
        safe_query = (original_query or "").strip()
        safe_reason = (reason or "").strip()

        if not safe_query:
            logger.debug("原始查詢為空，無法修正。")
            return original_query

        history_set = self._normalize_history(history, attempt)
        new_query = safe_query

        if "synonym_expansion" not in history_set:
            expanded = self._expand_with_synonyms(new_query)
            if expanded != new_query:
                return self._log_refinement(safe_query, expanded, safe_reason)

        if "boolean_relaxation" not in history_set:
            relaxed = self._relax_boolean(new_query)
            if relaxed != new_query:
                return self._log_refinement(safe_query, relaxed, safe_reason)

        if "keyword_shuffle" not in history_set:
            shuffled = self._shuffle_keywords(new_query)
            if shuffled != new_query:
                return self._log_refinement(safe_query, shuffled, safe_reason)

        lowered_reason = safe_reason.lower()
        if "keywords" in lowered_reason:
            new_query = self._broaden_query(new_query)
        elif "short" in lowered_reason or "invalid" in lowered_reason:
            new_query = self._reinforce_intent(new_query, attempt)

        if attempt > 2:
            new_query = self._truncate_query(new_query)

        if not new_query:
            new_query = safe_query

        return self._log_refinement(safe_query, new_query, safe_reason)

    def _load_synonyms(self) -> None:
        synonyms_path = Path(__file__).with_name("domain_synonyms.json")
        if not synonyms_path.exists():
            logger.warning("找不到同義詞設定檔: {}", synonyms_path)
            return

        try:
            payload = json.loads(synonyms_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("讀取同義詞設定檔失敗: {} ({})", synonyms_path, exc)
            return

        synonyms = payload.get("synonyms")
        mode = payload.get("mode", "unidirectional")
        if not isinstance(synonyms, dict):
            logger.warning("同義詞設定檔格式錯誤，缺少 synonyms 欄位。")
            return

        normalized: dict[str, list[str]] = {}
        for key, values in synonyms.items():
            if not isinstance(key, str) or not isinstance(values, list):
                continue
            cleaned = [value for value in values if isinstance(value, str) and value.strip()]
            if cleaned:
                normalized[key] = cleaned

        if not normalized:
            logger.warning("同義詞設定檔無有效條目。")
            return

        self._synonyms = normalized
        self._synonym_mode = "bidirectional" if str(mode).lower() == "bidirectional" else "unidirectional"

    def _expand_with_synonyms(self, query: str) -> str:
        if not self._synonyms:
            return query

        expanded_query = query
        for term, alternatives in self._synonyms.items():
            expanded_query = self._apply_synonym(expanded_query, term, alternatives)

            if self._synonym_mode == "bidirectional":
                for alternative in alternatives:
                    expanded_query = self._apply_synonym(expanded_query, alternative, [term])

        return expanded_query

    def _apply_synonym(self, query: str, term: str, alternatives: List[str]) -> str:
        if not term or not alternatives:
            return query

        pattern = re.compile(rf"(?i)(?<![a-zA-Z0-9_]){re.escape(term)}(?![a-zA-Z0-9_])")
        if not pattern.search(query):
            return query

        unique_terms = [term] + [alt for alt in alternatives if alt.lower() != term.lower()]
        or_group = " OR ".join(f"\"{item}\"" if " " in item else item for item in unique_terms)
        replacement = f"({or_group})"
        return pattern.sub(replacement, query)

    def _relax_boolean(self, query: str) -> str:
        relaxed = re.sub(r"\bAND\b", "OR", query, flags=re.IGNORECASE)
        return relaxed.strip()

    def _shuffle_keywords(self, query: str) -> str:
        tokens = self._tokenize(query)
        if len(tokens) < 4:
            return query

        unique_tokens = list(dict.fromkeys(tokens))
        sorted_tokens = sorted(unique_tokens, key=len, reverse=True)
        return " ".join(sorted_tokens)

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

    @staticmethod
    def _normalize_history(history: Optional[Sequence[str]], attempt: int) -> set[str]:
        if history is None:
            inferred = []
            if attempt > 1:
                inferred.append("synonym_expansion")
            if attempt > 2:
                inferred.append("boolean_relaxation")
            if attempt > 3:
                inferred.append("keyword_shuffle")
            return {step.lower() for step in inferred}

        return {str(step).lower() for step in history if step}

    @staticmethod
    def _log_refinement(original: str, refined: str, reason: str) -> str:
        logger.debug("Refining query: '{}' -> '{}' due to '{}'", original, refined, reason)
        return refined
