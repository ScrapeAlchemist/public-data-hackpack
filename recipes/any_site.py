"""Fetch any public page as markdown through Bright Data and save it, so you can write a parser.

  python recipes/any_site.py "https://www.yelp.com/search?find_desc=boba&find_loc=Berkeley%2C+CA"
  python recipes/any_site.py "<url>" --out out/pages/my_page.md
  python recipes/any_site.py "<url>" --html          # the page HTML instead of markdown
  python recipes/any_site.py "<url>" --refresh       # skip the 6-hour cache

It uses the same fetch code as Intern Intel (python/fetch.py): the Bright Data Web Unlocker
REST API with data_format=markdown, your key and zone from .env, the cache/ folder, and one
retry for an empty answer. Quote the URL: '&' and '?' mean something to your shell.

After it saves the page it prints a first look: the size, the headings, and how often each
kind of link appears. A heading or link pattern that repeats once per result is where a
parser starts. recipes/your_site.md walks through the rest, and recipes/parse_yelp.py is a
worked example.
"""

import argparse
import hashlib
import re
import sys
import urllib.parse
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

import fetch  # noqa: E402

LINK = re.compile(r"\]\((?P<href>[^)\s]+)")


def default_path(url, html):
    host = urllib.parse.urlsplit(url).hostname or "page"
    host = re.sub(r"^www\.", "", host).replace(".", "_")
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
    return ROOT / "out" / "pages" / f"{host}_{digest}.{'html' if html else 'md'}"


def link_patterns(md, top=8):
    """Most common link shapes: the path with digits and ids replaced, e.g. /biz/<name>."""
    shapes = Counter()
    for m in LINK.finditer(md):
        parts = urllib.parse.urlsplit(m.group("href"))
        if parts.scheme not in ("", "http", "https") or not parts.path or parts.path == "/":
            continue
        segments = parts.path.strip("/").split("/")
        shape = "/" + "/".join([segments[0]] + ["<name>" for _ in segments[1:]])
        shapes[(parts.hostname or "", shape)] += 1
    return shapes.most_common(top)


def ascii_line(text, width=110):
    text = re.sub(r"[\u00a0\u2000-\u200a\u202f]", " ", text)   # non-breaking and thin spaces
    text = text.encode("ascii", "replace").decode("ascii")
    return text if len(text) <= width else text[: width - 3] + "..."


def headings(md):
    """Markdown headings of levels 1 to 3: the level 1 headings (the page title) first, then
    the rest in page order."""
    found = [(len(m.group(1)), m.group(0).strip())
             for m in re.finditer(r"^\s*(#{1,3})\s.*$", md, flags=re.MULTILINE)]
    return [text for _, text in sorted(found, key=lambda pair: pair[0] > 1)]


def main(argv=None):
    p = argparse.ArgumentParser(description="Save any public page as markdown, fetched through Bright Data.")
    p.add_argument("url")
    p.add_argument("--out", help="where to save it (default: out/pages/<site>_<hash>.md)")
    p.add_argument("--html", action="store_true", help="save the page HTML instead of markdown")
    p.add_argument("--refresh", action="store_true", help="ignore the 6-hour cache and fetch again")
    args = p.parse_args(argv)

    page = fetch.fetch_one(args.url, markdown=not args.html, refresh=args.refresh)
    if not page.ok:
        print(f"FAILED after {page.seconds} s: {page.error}")
        return 1
    out = Path(args.out) if args.out else default_path(args.url, args.html)
    fetch.write_text(out, page.text)

    print(f"Saved {len(page.text):,} characters to {out} ({page.origin}, {page.seconds} s)")
    if args.html:
        return 0
    found = headings(page.text)
    print(f"\nHeadings ({len(found)}, page title first):")
    for h in found[:12]:
        print("  " + ascii_line(h))
    if len(found) > 12:
        print(f"  ... {len(found) - 12} more")
    print("\nMost common links (a pattern repeated once per result is a good parser anchor):")
    for (host, shape), count in link_patterns(page.text):
        print(f"  {count:4d}  {host}{shape}")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
