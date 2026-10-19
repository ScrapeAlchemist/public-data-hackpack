"""Intern Intel: internship listings from Indeed and Glassdoor, merged into one table.

  python python/intern_intel.py                                   # software engineer intern, San Francisco, CA
  python python/intern_intel.py --role "data science intern" --location "New York, NY"
  python python/intern_intel.py --pages 2 --min-hourly 40
  python python/intern_intel.py --offline                         # no network and no API key: reads fixtures/
  python python/intern_intel.py --print-urls                      # only print the search URLs
  python python/intern_intel.py --from-dir cache/cli/my-search    # parse pages fetched by another tool

Steps: build URLs -> fetch markdown through Bright Data (cached) -> parse each site ->
merge and remove duplicates -> filter -> sort by hourly pay -> print, and write
out/intern_intel.csv and out/intern_intel.json.

--print-urls and --from-dir split the fetch step out, so another tool can do it. The
scripts in cli/ use them: they ask for the URLs, fetch each page with the Bright Data
CLI, save them as indeed_p1.md, glassdoor_p1.md, ... and hand the folder back here.
"""

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import dedupe
import fetch
import parsers
import sources

OUT_DIR = fetch.REPO_ROOT / "out"
CSV_FIELDS = ["title", "company", "location", "pay", "pay_hourly_min", "rating", "sources",
              "indeed_url", "glassdoor_url", "key"]


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Internship listings from Indeed and Glassdoor in one table.")
    p.add_argument("--role", default="software engineer intern", help="search keywords")
    p.add_argument("--location", default="San Francisco, CA", help='e.g. "New York, NY" or "Remote"; empty = whole US')
    p.add_argument("--pages", type=int, default=1, choices=range(1, sources.MAX_PAGES + 1),
                   help="1 = top results per site, 2 = also the newest listings per site")
    p.add_argument("--title-includes", help="keep rows whose title contains this text")
    p.add_argument("--location-includes", help="keep rows whose location contains this text")
    p.add_argument("--min-hourly", type=float, help="keep rows paying at least this many USD per hour")
    p.add_argument("--limit", type=int, help="print only the first N rows (files get all rows)")
    p.add_argument("--refresh", action="store_true", help="ignore the 6-hour cache and fetch again")
    p.add_argument("--offline", action="store_true", help="read pages from fixtures/ only (no network, no API key)")
    p.add_argument("--save-fixtures", nargs="?", const="", metavar="PREFIX",
                   help="copy the fetched pages into fixtures/ as <PREFIX><source>_p<page>.md")
    p.add_argument("--print-urls", action="store_true",
                   help="print the search URLs (source, page, url; tab separated) and exit")
    p.add_argument("--from-dir", metavar="DIR",
                   help="parse markdown files already in DIR (indeed_p1.md, glassdoor_p1.md, ...) "
                        "instead of fetching; --role, --location and --pages are then not used")
    args = p.parse_args(argv)
    if args.from_dir and (args.offline or args.refresh or args.print_urls or args.save_fixtures is not None):
        p.error("--from-dir reads files you already have, so it does not combine with "
                "--offline, --refresh, --print-urls or --save-fixtures")
    return args


def plan_urls(args):
    """[(source, page, url)] in a fixed order: Indeed pages, then Glassdoor pages."""
    plan = [("indeed", n, sources.indeed_url(args.role, args.location, n)) for n in range(1, args.pages + 1)]

    def fetch_raw(url):
        page = fetch.fetch_one(url, markdown=False, refresh=args.refresh, offline=args.offline)
        if not page.ok:
            raise LookupError(page.error)
        return page.text

    try:
        loc_type, loc_id = sources.resolve_glassdoor_location(args.location, fetch_raw)
    except (LookupError, ValueError) as e:
        print(f"[glassdoor] skipped: location lookup failed ({e})")
        return plan
    plan += [("glassdoor", n, sources.glassdoor_url(args.role, args.location, loc_type, loc_id, n))
             for n in range(1, args.pages + 1)]
    return plan


DIR_FILE = re.compile(r"^(indeed|glassdoor)(?:_p(\d+))?\.md$")


def pages_from_dir(directory):
    """Read saved search pages from a folder. Returns (plan, pages) like the fetch step does.

    File names: indeed_p1.md, indeed_p2.md, glassdoor_p1.md, glassdoor_p2.md ('indeed.md'
    counts as page 1). Other files are ignored. The order is Indeed pages, then Glassdoor
    pages, the same order a normal run uses, so both give the same table.
    """
    found = []
    for path in Path(directory).iterdir():
        m = DIR_FILE.match(path.name)
        if m and path.is_file():
            found.append((dedupe.SOURCE_ORDER.index(m.group(1)), int(m.group(2) or 1), path.name, m.group(1), path))
    found.sort()
    plan = [(source, n, str(path)) for _, n, _, source, path in found]
    pages = [fetch.Page(str(path), text=fetch.read_text(path), origin=f"file {path.name}")
             for _, _, _, _, path in found]
    return plan, pages


# ---------------------------------------------------------------- display

def ascii_text(s):
    s = (s or "").replace("\u2013", "-").replace("\u2014", "-").replace("\u2019", "'").replace("\u2026", "...")
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def compact_pay(row):
    pay = row["pay"]
    if not pay:
        return "-"
    for old, new in ((" (Employer provided)", ""), (" (Glassdoor est.)", " est."), (" an hour", "/hr"),
                     (" Per Hour", "/hr"), (" a year", "/yr"), (" a month", "/mo"), (" a week", "/wk"),
                     (" a day", "/day")):
        pay = pay.replace(old, new)
    if row["pay_hourly_min"] is not None and "/hr" not in pay:
        pay += f" (~${row['pay_hourly_min']:.0f}/hr)"
    return pay


COLUMNS = [("Title", 46), ("Company", 22), ("Location", 26), ("Pay", 34), ("Rating", 6), ("Sources", 16)]


def print_table(rows):
    def cell(text, width):
        text = ascii_text(text)
        return text.ljust(width) if len(text) <= width else text[: width - 3] + "..."

    print(" | ".join(cell(name, w) for name, w in COLUMNS))
    print("-+-".join("-" * w for _, w in COLUMNS))
    for r in rows:
        values = [r["title"], r["company"] or "-", r["location"] or "-", compact_pay(r),
                  f"{r['rating']:.1f}" if r["rating"] is not None else "-", "+".join(r["sources"])]
        print(" | ".join(cell(v, w) for v, (_, w) in zip(values, COLUMNS)))


# ---------------------------------------------------------------- files

def plain_number(x):
    """62.0 -> 62, so the JSON matches what JavaScript writes for the same value."""
    return int(x) if isinstance(x, float) and x.is_integer() else x


def _plain_rows(rows):
    return [{**r, "pay_hourly_min": plain_number(r["pay_hourly_min"]), "rating": plain_number(r["rating"])}
            for r in rows]


def json_text(rows):
    """The exact text of out/intern_intel.json. fixtures/expected/*.json hold this for the sample pages."""
    return json.dumps(_plain_rows(rows), indent=2, ensure_ascii=False) + "\n"


def write_outputs(rows):
    OUT_DIR.mkdir(exist_ok=True)
    clean = _plain_rows(rows)
    with open(OUT_DIR / "intern_intel.json", "w", encoding="utf-8", newline="") as f:
        f.write(json_text(rows))
    with open(OUT_DIR / "intern_intel.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(CSV_FIELDS)
        for r in clean:
            w.writerow([r["title"], r["company"], r["location"], r["pay"],
                        "" if r["pay_hourly_min"] is None else r["pay_hourly_min"],
                        "" if r["rating"] is None else r["rating"],
                        "|".join(r["sources"]), r["urls"].get("indeed", ""), r["urls"].get("glassdoor", ""),
                        r["key"]])


def save_fixtures(plan, pages, prefix):
    manifest_path = fetch.FIXTURES_DIR / "manifest.json"
    manifest = json.loads(fetch.read_text(manifest_path)) if manifest_path.exists() else {"pages": {}}
    for (source, n, url), page in zip(plan, pages):
        if page.ok and page.origin != "fixture":
            name = f"{prefix}{source}_p{n}.md"
            fetch.write_text(fetch.FIXTURES_DIR / name, page.text)
            manifest["pages"][url] = {"file": name, "source": source, "page": n,
                                      "fetched": time.strftime("%Y-%m-%d")}
            print(f"[fixtures] saved {name}")
    fetch.write_text(manifest_path, json.dumps(manifest, indent=2) + "\n")


# ---------------------------------------------------------------- main

def refetch_spanish(plan, pages):
    """Indeed sometimes sends its US search page in Spanish. Fetch such a page once more, without the cache."""
    for k, ((source, n, url), page) in enumerate(zip(plan, pages)):
        if source == "indeed" and page.ok and parsers.indeed_is_spanish(page.text):
            print(f"[indeed p{n}] the page came back in Spanish, fetching it once more")
            again = fetch.fetch_one(url, refresh=True)
            if again.ok:
                again.seconds = round(page.seconds + again.seconds, 1)
                pages[k] = again


def fetch_rows(args):
    """Fetch every planned page and parse it. Returns (plan, pages, rows from all pages)."""
    if args.from_dir:
        plan, pages = pages_from_dir(args.from_dir)
    else:
        plan = plan_urls(args)
        pages = fetch.fetch_many([url for _, _, url in plan], refresh=args.refresh, offline=args.offline)
        if not args.offline:
            refetch_spanish(plan, pages)
    all_rows = []
    for (source, n, url), page in zip(plan, pages):
        if not page.ok:
            print(f"[{source} p{n}] FAILED after {page.seconds} s: {page.error}")
            continue
        rows = parsers.PARSERS[source](page.text)
        all_rows += rows
        print(f"[{source} p{n}] {len(rows):2d} listings  ({page.origin}, {page.seconds} s)")
        if source == "indeed" and parsers.indeed_is_spanish(page.text):
            print(f"[indeed p{n}] warning: this page is in Spanish. Its rows are parsed, but check them.")
    return plan, pages, all_rows


def build_table(all_rows, args):
    """Merge, filter and sort. Returns (merged before filters, final rows)."""
    merged = dedupe.merge_rows(all_rows)
    rows = dedupe.sort_rows(dedupe.filter_rows(merged, args.title_includes, args.location_includes, args.min_hourly))
    return merged, rows


def run(args):
    t0 = time.monotonic()
    if args.print_urls:
        for source, n, url in plan_urls(args):
            print(f"{source}\t{n}\t{url}")
        return 0
    if args.from_dir and not Path(args.from_dir).is_dir():
        print(f"No such folder: {args.from_dir}")
        return 1
    plan, pages, all_rows = fetch_rows(args)
    if args.save_fixtures is not None:
        save_fixtures(plan, pages, args.save_fixtures)
    if not any(p.ok for p in pages):
        if args.from_dir:
            print(f"No indeed_p<N>.md or glassdoor_p<N>.md files in {args.from_dir}.")
        elif args.offline:
            print("No saved pages for this search. fixtures/manifest.json lists the saved ones.")
        else:
            print("Nothing fetched. Try again, or run with --offline to use the saved sample pages.")
        return 1

    merged, rows = build_table(all_rows, args)
    both = sum(1 for r in merged if len(r["sources"]) > 1)
    print()
    print_table(rows[: args.limit] if args.limit else rows)
    write_outputs(rows)
    print()
    print(f"{len(all_rows)} listings -> {len(merged)} unique jobs ({both} on both sites)"
          f" -> {len(rows)} after filters. Wrote out/intern_intel.csv and out/intern_intel.json"
          f" in {time.monotonic() - t0:.1f} s.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(run(parse_args()))
