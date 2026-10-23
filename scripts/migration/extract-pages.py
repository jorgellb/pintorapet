#!/usr/bin/env python3
"""Extract editorial text from live WordPress pages into migration/pages.json."""

from __future__ import annotations

import html as htmlmod
import json
import pathlib
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser

UA = "PetsDrawingsMigration/1.0 (+local rebuild)"
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "migration" / "source" / "pages"

PAGES = [
    ("about", "en", "https://petsdrawings.com/about-me/"),
    ("about", "es", "https://petsdrawings.com/es/about-me/"),
    ("contact", "en", "https://petsdrawings.com/contact/"),
    ("contact", "es", "https://petsdrawings.com/es/contact/"),
    ("commissions", "en", "https://petsdrawings.com/order/"),
    ("commissions", "es", "https://petsdrawings.com/es/order/"),
    ("gallery", "en", "https://petsdrawings.com/gallery/"),
    ("gallery", "es", "https://petsdrawings.com/es/gallery/"),
    ("work", "en", "https://petsdrawings.com/work/"),
    ("work", "es", "https://petsdrawings.com/es/work/"),
]


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.capture = False
        self.depth = 0
        self.skip = 0
        self.title: str | None = None
        self.in_title = False
        self.in_h1 = False
        self.h1: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_d = dict(attrs)
        cls = attrs_d.get("class") or ""
        if tag == "title":
            self.in_title = True
        if tag == "h1" and self.capture:
            self.in_h1 = True
        if tag in ("script", "style", "noscript", "svg"):
            self.skip += 1
            return
        if self.skip:
            return
        if tag in ("main", "article") or "entry-content" in cls:
            if not self.capture and (tag in ("main", "article") or "entry-content" in cls):
                self.capture = True
                self.depth = 1
                return
        if self.capture:
            if tag in ("main", "article", "div", "section"):
                self.depth += 1
            if tag == "br":
                self.parts.append("\n")
            if tag in ("p", "h1", "h2", "h3", "li", "div"):
                self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False
        if tag == "h1":
            self.in_h1 = False
        if tag in ("script", "style", "noscript", "svg") and self.skip:
            self.skip -= 1
            return
        if self.capture and tag in ("main", "article", "div", "section"):
            self.depth -= 1
            if self.depth <= 0:
                self.capture = False
        if self.capture and tag in ("p", "h1", "h2", "h3", "li"):
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.in_title and self.title is None:
            self.title = data.strip()
        if self.skip:
            return
        text = data.strip()
        if not text:
            return
        if self.in_h1 and self.h1 is None:
            self.h1 = text
        if self.capture:
            self.parts.append(text + " ")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def clean(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            lines.append("")
            continue
        if len(s) < 2:
            continue
        if s.lower() in {"menu", "search", "cart", "home", "skip to content"}:
            continue
        lines.append(s)
    return "\n".join(lines).strip()


def paragraphs(text: str) -> list[str]:
    chunks = [c.strip() for c in re.split(r"\n\s*\n", text) if c.strip()]
    # Drop pure heading duplicates of first line
    return [c for c in chunks if len(c) > 20 or c.endswith(".")]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results: dict = {}
    for key, locale, url in PAGES:
        raw = fetch(url)
        (OUT_DIR / f"{key}-{locale}.html").write_bytes(raw)
        parser = TextExtractor()
        parser.feed(raw.decode("utf-8", errors="replace"))
        body = clean("".join(parser.parts))
        if len(body) < 80:
            text = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw.decode("utf-8", "replace"))
            text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
            text = re.sub(r"(?is)<[^>]+>", "\n", text)
            body = clean(htmlmod.unescape(text))
            parts = [p for p in body.split("\n") if len(p) > 40]
            body = "\n\n".join(parts[:40])
        paras = paragraphs(body)
        # Remove leading h1-only paragraph if duplicated
        if paras and parser.h1 and paras[0].strip() == parser.h1.strip():
            paras = paras[1:]
        results.setdefault(key, {})[locale] = {
            "sourceUrl": url,
            "documentTitle": parser.title,
            "h1": parser.h1,
            "paragraphs": paras,
            "text": body[:12000],
            "charCount": len(body),
        }
        print(key, locale, "paras", len(paras), "chars", len(body))

    out = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "pages": results,
    }
    (ROOT / "migration" / "pages.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("wrote migration/pages.json")


if __name__ == "__main__":
    main()
