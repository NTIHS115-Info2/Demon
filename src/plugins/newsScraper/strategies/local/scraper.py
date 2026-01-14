# src/plugins/newsScraper/strategies/local/scraper.py
import sys
import json
import requests
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
import asyncio
from pydantic import BaseModel, ValidationError, field_validator, ConfigDict


class ScraperInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str
    article_count: int = 3

    @field_validator("url", mode="before")
    @classmethod
    def validate_url(cls, value):
        if value is None:
            raise ValueError("URL cannot be empty")
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                raise ValueError("URL cannot be empty")
            return stripped
        return value

    @field_validator("article_count", mode="before")
    @classmethod
    def sanitize_article_count(cls, value):
        return _sanitize_article_limit(value, fallback=3)

class ForagerStrategy:
    """
    遠端策略：負責從外部網路來源獲取並清理新聞內容。
    V1.2 版本（來自歷史紀錄）：
    - 主要爬取目標為 RSS Feed，更穩定、更結構化。
    - 使用標準的 <link> 標籤解析 RSS。
    - 針對新聞文章頁面進行了 HTML 清理優化。
    """
    def __init__(self):
        self.headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7',
            'Cache-Control': 'max-age=0',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        }

    def _clean_html_content(self, html_text: str) -> str:
        """
        通用 HTML 清理器，優先提取 article 標籤。
        """
        soup = BeautifulSoup(html_text, 'lxml')
        article_body = soup.find('article')
        if not article_body:
            article_body = soup
        paragraphs = article_body.find_all('p')
        cleaned_text = '\n'.join([p.get_text(strip=True) for p in paragraphs])
        return cleaned_text

    async def fetch_news(self, rss_url: str, article_limit: int = 3) -> dict:
        """
        非同步執行新聞獲取的主函式。
        """
        all_cleaned_text = ""
        try:
            response = requests.get(rss_url, headers=self.headers, timeout=15)
            response.raise_for_status()
            
            root = ET.fromstring(response.content)
            
            # [Copilot 審查修正] 確保 link 標籤存在且其 text 內容不為空
            article_links = [
                item.find('link').text
                for item in root.findall('.//item')
                if item.find('link') is not None and item.find('link').text
            ]

            for link in article_links[:article_limit]:
                if not link: continue
                
                article_response = requests.get(link, headers=self.headers, timeout=10)
                article_response.raise_for_status()
                
                cleaned_article = self._clean_html_content(article_response.text)
                all_cleaned_text += f"--- News Source: {link} ---\n\n{cleaned_article}\n\n"
            
            return {
                "success": True,
                "result": { "source_url": rss_url, "article_text": all_cleaned_text.strip() },
                "resultType": "object"
            }
        except Exception as e:
            return { "success": False, "error": f"ForagerStrategy failed: {str(e)}" }

def _sanitize_article_limit(raw_limit, fallback=3):
    try:
        parsed = int(raw_limit)
        if parsed > 0:
            return parsed
    except (TypeError, ValueError):
        # Ignore parsing errors and use fallback value
        pass
    return fallback


async def main():
    if len(sys.argv) == 2:
        try:
            payload = json.loads(sys.argv[1])
            input_model = ScraperInput.model_validate(payload)
            forager = ForagerStrategy()
            result = await forager.fetch_news(
                rss_url=input_model.url,
                article_limit=input_model.article_count,
            )
            # 強制以 UTF-8 編碼輸出 JSON，確保 Node.js 能正確解析
            sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
        except (json.JSONDecodeError, ValidationError) as exc:
            error_result = {"success": False, "error": f"Invalid input: {exc}"}
            sys.stdout.buffer.write(json.dumps(error_result, ensure_ascii=False).encode("utf-8"))
        except Exception as exc:
            error_result = {"success": False, "error": f"ForagerStrategy failed: {exc}"}
            sys.stdout.buffer.write(json.dumps(error_result, ensure_ascii=False).encode("utf-8"))
    else:
        error_result = {"success": False, "error": "No JSON payload provided to scraper.py"}
        sys.stdout.buffer.write(json.dumps(error_result, ensure_ascii=False).encode("utf-8"))

if __name__ == '__main__':
    asyncio.run(main())
