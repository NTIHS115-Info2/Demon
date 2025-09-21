# plugins/news_scraper/strategies/remote/scraper.py
import sys, json, requests, asyncio, time, hashlib
from bs4 import BeautifulSoup
from pathlib import Path
from loguru import logger
from playwright.async_api import async_playwright
from fake_useragent import UserAgent
from data_models import ScraperOutput, ScraperResult

log_path = Path(__file__).parent.parent.parent.parent.parent / "logs" / "plugin.log"
logger.add(log_path, rotation="10 MB", retention="7 days", level="INFO")
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_EXPIRATION = 3600
CACHE_DIR.mkdir(exist_ok=True)

class ForagerStrategy:
    """ V12.0.4: Final Alpha Version """
    def __init__(self):
        logger.info("ForagerStrategy (V12.0.4) 已初始化。")
        self.ua = UserAgent()

    def _get_random_headers(self) -> dict: return {'User-Agent': self.ua.random}
    def _clean_html_content(self, html_text: str) -> str:
        soup = BeautifulSoup(html_text, 'lxml')
        article_body = soup.find('article')
        if not article_body:
            logger.warning("在頁面中未找到 <article> 標籤，將採用通用的 <p> 標籤提取策略。")
            article_body = soup
        paragraphs = article_body.find_all('p')
        cleaned_text = '\n'.join([p.get_text(strip=True) for p in paragraphs if p.get_text(strip=True)])
        return cleaned_text

    async def _fetch_with_browser(self, url: str) -> str:
        logger.info(f"檢測到反爬蟲機制，切換至 Playwright 攻城槌模式: {url}")
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(user_agent=self.ua.random)
            await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            content = await page.content()
            await browser.close()
            return content

    async def fetch_content(self, url: str) -> ScraperOutput:
        cache_key = hashlib.md5(url.encode('utf-8')).hexdigest() + ".json"
        cache_file = CACHE_DIR / cache_key
        if cache_file.exists():
            cached_data = json.loads(cache_file.read_text(encoding="utf-8"))
            if time.time() - cached_data["timestamp"] < CACHE_EXPIRATION:
                logger.info(f"從快取命中: {url}")
                return ScraperOutput.model_validate(cached_data["content"])
        try:
            html_content = ""
            logger.info(f"正在使用 Requests 抓取: {url}")
            try:
                response = requests.get(url, headers=self._get_random_headers(), timeout=15)
                response.raise_for_status()
                html_content = response.text
            except requests.exceptions.RequestException as req_err:
                logger.warning(f"Requests 抓取失敗: {req_err}。將嘗試使用 Playwright。")
                html_content = await self._fetch_with_browser(url)
            if not html_content: raise ValueError("兩種抓取方法均未能獲取到頁面內容。")
            cleaned_article = self._clean_html_content(html_content)
            result_obj = ScraperResult(source_url=url, article_text=cleaned_article.strip())
            output_obj = ScraperOutput(success=True, result=result_obj)
            cache_content = {"timestamp": time.time(), "content": output_obj.model_dump()}
            cache_file.write_text(json.dumps(cache_content, ensure_ascii=False), encoding="utf-8")
            return output_obj
        except Exception as e:
            error_message = f"ForagerStrategy 在所有嘗試後均失敗 for URL {url}: {e}"
            logger.error(error_message)
            return ScraperOutput(success=False, error=error_message)

def main():
    if len(sys.argv) > 1:
        url = sys.argv[1]
        async def async_main():
            forager = ForagerStrategy()
            result_model = await forager.fetch_content(url=url)
            sys.stdout.buffer.write(result_model.model_dump_json().encode('utf-8'))
        asyncio.run(async_main())
    else:
        error_result = ScraperOutput(success=False, error="No URL provided to scraper.py")
        sys.stdout.buffer.write(error_result.model_dump_json().encode('utf-8'))

if __name__ == '__main__':
    main()