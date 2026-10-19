"""Worked example for recipes/your_site.md: turn a saved Yelp search page into rows.

  python recipes/any_site.py "https://www.yelp.com/search?find_desc=boba&find_loc=Berkeley%2C+CA"
  python recipes/parse_yelp.py out/pages/yelp_com_02de37bc.md

any_site.py prints the name of the file it saved. This script prints one row per ranked
result and writes the rows next to the page as JSON (same name, .json instead of .md).

How the parser was found, by reading the saved markdown:
  1. Each ranked result has a heading line, "### 1. [Shop name](/biz/shop-name-berkeley?osq=boba)".
     That line is the anchor: one per result, with the rank, the name and the link.
  2. The next lines hold the rating and review count, "4.6 (323 reviews)", then the area,
     the price level and the opening hours run together, "Telegraph Ave$$Closed until 11:30 AM".
  3. Sponsored results above and below the list link to /adredir and have no rank, so the
     anchor skips them.
Opening hours change with the time the page was fetched, so they are left out.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

import fetch  # noqa: E402
import parsers  # noqa: E402

RESULT = re.compile(r"^(?P<rank>\d+)\.\s*\[(?P<name>.+?)\]\((?P<path>/biz/[^)\s?]+)[^)\s]*\)$")
RATING = re.compile(r"^(?P<rating>\d(?:\.\d)?) \((?P<reviews>[\d.,]+k?) reviews?\)$")
AREA = re.compile(r"^(?P<area>.*?)(?P<price>\$+)?(?P<hours>(?:Opens?|Closed)\b.*)?$")


def review_count(text):
    """'323' -> 323, '1,204' -> 1204, '1.7k' -> 1700"""
    text = text.replace(",", "")
    return round(float(text[:-1]) * 1000) if text.endswith("k") else int(text)


def parse_yelp(md):
    lines = parsers.clean_lines(md)   # the same cleanup the Indeed and Glassdoor parsers use
    rows = []
    for i, line in enumerate(lines):
        m = RESULT.match(line)
        if not m:
            continue
        row = {"rank": int(m["rank"]), "name": m["name"], "url": "https://www.yelp.com" + m["path"],
               "rating": None, "reviews": None, "area": "", "price": ""}
        for nxt in lines[i + 1:i + 3]:
            rating = RATING.match(nxt)
            if rating:
                row["rating"] = float(rating["rating"])
                row["reviews"] = review_count(rating["reviews"])
            elif not RESULT.match(nxt) and not nxt.startswith(('"', "[")):
                area = AREA.match(nxt)
                row["area"] = area["area"].strip()
                row["price"] = area["price"] or ""
                break
            else:
                break
        rows.append(row)
    return rows


def main(argv=None):
    p = argparse.ArgumentParser(description="Parse a Yelp search page saved by recipes/any_site.py.")
    p.add_argument("page", help="the saved .md file")
    args = p.parse_args(argv)

    path = Path(args.page)
    if not path.exists():
        print(f"No such file: {path}")
        return 1
    rows = parse_yelp(fetch.read_text(path))
    if not rows:
        print("No ranked results found. Open the file and check that the results still look"
              " like '### 1. [Name](/biz/...)'.")
        return 1

    print(f"{'#':>3}  {'name':<28}  {'rating':>6}  {'reviews':>7}  {'area':<20}  price")
    for r in rows:
        rating = "" if r["rating"] is None else f"{r['rating']:.1f}"
        reviews = "" if r["reviews"] is None else str(r["reviews"])
        print(f"{r['rank']:>3}  {r['name'][:28]:<28}  {rating:>6}  {reviews:>7}  {r['area'][:20]:<20}  {r['price']}")
    out = path.with_suffix(".json")
    fetch.write_text(out, json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
    print(f"\n{len(rows)} results, saved to {out}")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
