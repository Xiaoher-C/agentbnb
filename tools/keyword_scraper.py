"""Simple keyword scraper — search web pages for text containing specific keywords."""

import re
import sys
import urllib.request
from html.parser import HTMLParser


class TextExtractor(HTMLParser):
    """Extract visible text from HTML, skipping script/style tags."""

    def __init__(self):
        super().__init__()
        self._text = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            self._text.append(data)

    def get_text(self) -> str:
        return " ".join(self._text)


def fetch_page(url: str) -> str:
    """Fetch HTML content from a URL."""
    req = urllib.request.Request(url, headers={"User-Agent": "KeywordScraper/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def extract_text(html: str) -> str:
    """Strip HTML tags, return visible text."""
    parser = TextExtractor()
    parser.feed(html)
    return parser.get_text()


def search_keywords(text: str, keywords: list[str], context: int = 80) -> list[dict]:
    """Find all occurrences of keywords in text, return surrounding context."""
    results = []
    for kw in keywords:
        for m in re.finditer(re.escape(kw), text, re.IGNORECASE):
            start = max(0, m.start() - context)
            end = min(len(text), m.end() + context)
            snippet = text[start:end].strip()
            results.append({"keyword": kw, "position": m.start(), "snippet": snippet})
    return results


def main():
    if len(sys.argv) < 3:
        print("Usage: python keyword_scraper.py <url> <keyword1> [keyword2 ...]")
        print("Example: python keyword_scraper.py https://example.com python scraping")
        sys.exit(1)

    url = sys.argv[1]
    keywords = sys.argv[2:]

    print(f"Fetching: {url}")
    html = fetch_page(url)
    text = extract_text(html)

    print(f"Searching for: {', '.join(keywords)}\n")
    results = search_keywords(text, keywords)

    if not results:
        print("No matches found.")
        return

    print(f"Found {len(results)} match(es):\n")
    for i, r in enumerate(results, 1):
        print(f"[{i}] Keyword: \"{r['keyword']}\" (position {r['position']})")
        print(f"    ...{r['snippet']}...")
        print()


if __name__ == "__main__":
    main()
