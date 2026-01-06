# src/plugins/newsScraper/strategies/local/data_models.py
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

# --- Researcher Models ---
class SearchItem(BaseModel):
    url: str
    title: str = ""
    snippet: str = ""

    @field_validator("url")
    @classmethod
    def normalize_url(cls, value: str) -> str:
        if not value:
            return value
        if not value.startswith(("http://", "https://")):
            if value.startswith("//"):
                value = "https:" + value
            else:
                value = "https://" + value.lstrip("/")

        parsed = urlparse(value)
        if not parsed.netloc:
            raise ValueError(f"Invalid URL (missing netloc): {value}")
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Invalid scheme: {parsed.scheme}")

        qs = parse_qs(parsed.query)
        clean_qs = {
            key: val
            for key, val in qs.items()
            if not key.startswith("utm_") and key not in ("gclid", "fbclid")
        }
        new_query = urlencode(clean_qs, doseq=True)
        return urlunparse(
            (parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, "")
        )


class ResearcherResult(BaseModel):
    items: List[SearchItem] = Field(default_factory=list)

    @property
    def discovered_urls(self) -> List[str]:
        return [item.url for item in self.items]

class ResearcherOutput(BaseModel):
    success: bool
    result: Optional[ResearcherResult] = None
    error: Optional[str] = None
    resultType: str = "object"

# --- Scraper Models ---
class ScraperResult(BaseModel):
    source_url: str
    article_text: str

class ScraperOutput(BaseModel):
    success: bool
    result: Optional[ScraperResult] = None
    error: Optional[str] = None
    resultType: str = "object"

# --- Librarian Models ---
class LibrarianInput(BaseModel):
    text_content: str
    query: str

class RelevantSection(BaseModel):
    chunk: str
    score: float

class LibrarianResult(BaseModel):
    relevant_sections: List[RelevantSection]

class LibrarianOutput(BaseModel):
    success: bool
    result: Optional[LibrarianResult] = None
    error: Optional[str] = None
    resultType: str = "object"

# --- Summarizer Models ---
class SummarizerInput(BaseModel):
    chunks: List[str]
    mode: str = "single"
    length: str = "medium"

class MultiAngleSummary(BaseModel):
    original_chunk: str
    summary: str

class SummarizerResult(BaseModel):
    summary: Optional[str] = None
    multi_angle_summaries: Optional[List[MultiAngleSummary]] = None

class SummarizerOutput(BaseModel):
    success: bool
    result: Optional[SummarizerResult] = None
    error: Optional[str] = None
    resultType: str = "object"

# --- Evaluator Models ---
class EvaluationResult(BaseModel):
    score: float
    is_passing: bool
    reason: str
