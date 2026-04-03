#!/usr/bin/env python3
"""
PDF Parser — 自動化 PDF 解析腳本
從 PDF 檔案提取文本內容，輸出結構化 JSON 資料。

依賴安裝：
    pip install pymupdf

使用方式：
    # 命令列
    python pdf_parser.py input.pdf
    python pdf_parser.py input.pdf -o output.json
    python pdf_parser.py input.pdf --pages 1-5
    python pdf_parser.py input.pdf --pages 1,3,7

    # 作為模組
    from pdf_parser import parse_pdf
    result = parse_pdf("input.pdf")
"""

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

try:
    import fitz  # pymupdf
except ImportError:
    print("錯誤：缺少 pymupdf 套件。請執行：pip install pymupdf", file=sys.stderr)
    sys.exit(1)


@dataclass
class PageData:
    """單頁解析結果"""
    page_number: int
    text: str
    word_count: int
    char_count: int
    width: float
    height: float


@dataclass
class PDFResult:
    """整份 PDF 解析結果"""
    file_path: str
    total_pages: int
    parsed_pages: int
    total_word_count: int
    total_char_count: int
    metadata: dict = field(default_factory=dict)
    pages: list[PageData] = field(default_factory=list)


def parse_page_range(spec: str, total_pages: int) -> list[int]:
    """
    解析頁碼規格，支援：
      "1-5"    → [1,2,3,4,5]
      "1,3,7"  → [1,3,7]
      "2-4,8"  → [2,3,4,8]
    頁碼從 1 開始。超出範圍的頁碼會被忽略。
    """
    pages: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start = max(1, int(start_s))
            end = min(total_pages, int(end_s))
            pages.update(range(start, end + 1))
        else:
            p = int(part)
            if 1 <= p <= total_pages:
                pages.add(p)
    return sorted(pages)


def parse_pdf(
    file_path: str | Path,
    page_range: str | None = None,
) -> PDFResult:
    """
    解析 PDF 檔案，回傳結構化結果。

    Args:
        file_path: PDF 檔案路徑
        page_range: 可選頁碼範圍 (例如 "1-5" 或 "1,3,7")

    Returns:
        PDFResult 包含所有頁面的文本與統計資料

    Raises:
        FileNotFoundError: 檔案不存在
        ValueError: 檔案無法作為 PDF 開啟
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"檔案不存在：{path}")

    try:
        doc = fitz.open(str(path))
    except Exception as e:
        raise ValueError(f"無法開啟 PDF：{e}") from e

    total_pages = len(doc)

    if page_range:
        target_pages = parse_page_range(page_range, total_pages)
    else:
        target_pages = list(range(1, total_pages + 1))

    pages: list[PageData] = []
    total_words = 0
    total_chars = 0

    for page_num in target_pages:
        page = doc[page_num - 1]  # fitz 使用 0-based index
        text = page.get_text("text")
        words = len(text.split())
        chars = len(text)
        rect = page.rect

        pages.append(PageData(
            page_number=page_num,
            text=text,
            word_count=words,
            char_count=chars,
            width=round(rect.width, 2),
            height=round(rect.height, 2),
        ))
        total_words += words
        total_chars += chars

    # 提取 PDF metadata
    raw_meta = doc.metadata or {}
    metadata = {k: v for k, v in raw_meta.items() if v}

    doc.close()

    return PDFResult(
        file_path=str(path.resolve()),
        total_pages=total_pages,
        parsed_pages=len(pages),
        total_word_count=total_words,
        total_char_count=total_chars,
        metadata=metadata,
        pages=pages,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="PDF 解析工具")
    parser.add_argument("pdf", help="PDF 檔案路徑")
    parser.add_argument("-o", "--output", help="輸出 JSON 檔案路徑（預設印到 stdout）")
    parser.add_argument("-p", "--pages", help="頁碼範圍，例如 '1-5' 或 '1,3,7'")
    parser.add_argument("--text-only", action="store_true", help="只輸出純文本，不輸出 JSON")
    args = parser.parse_args()

    try:
        result = parse_pdf(args.pdf, page_range=args.pages)
    except (FileNotFoundError, ValueError) as e:
        print(f"錯誤：{e}", file=sys.stderr)
        sys.exit(1)

    if args.text_only:
        output = "\n\n".join(
            f"--- 第 {p.page_number} 頁 ---\n{p.text}" for p in result.pages
        )
    else:
        output = json.dumps(asdict(result), ensure_ascii=False, indent=2)

    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"已寫入：{args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
