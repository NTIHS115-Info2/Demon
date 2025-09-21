# plugins/news_scraper/strategies/remote/data_models.py
from pydantic import BaseModel, Field
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
# [V12.0.5 核心修正] 補上缺失的 LibrarianInput 模型
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
    resultType: str = "list"