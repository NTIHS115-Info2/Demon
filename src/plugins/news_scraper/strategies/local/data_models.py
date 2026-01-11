# src/plugins/news_scraper/strategies/local/data_models.py
from pydantic import BaseModel
from typing import List, Optional

# --- Researcher Models ---
class ResearcherResult(BaseModel):
    discovered_urls: List[str]

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