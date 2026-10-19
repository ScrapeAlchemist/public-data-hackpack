r"""Watch a search and print only the internship listings that are new since the last run.

  python recipes/watch.py                                   # same options as python/intern_intel.py
  python recipes/watch.py --role "data science intern" --location "New York, NY" --pages 2
  python recipes/watch.py --min-hourly 40                   # filters only change what is shown
  python recipes/watch.py --refresh                         # skip the 6-hour page cache

How it works: it runs the normal Intern Intel pipeline (fetch, parse, merge, filter), writes
out/intern_intel.csv and out/intern_intel.json as usual, then compares the merged listings
with the ones it saved for the same search last time. A listing is new when its key
(company + title, see python/dedupe.py) was not there before.

Files, one set per search (role + location + pages):
  out/watch/<search>.json       every listing seen on the last run (the baseline)
  out/watch/<search>.new.json   the listings that were new on the last run, for a notification step

The first run of a search only saves the baseline. If any page fails to fetch, the baseline
is not updated, so a site that was down does not make all of its listings look new next time.
Pages younger than 6 hours come from cache/, so run it less often than that, or pass --refresh.

Scheduling. These are templates: the schedulers themselves were not run while testing this
repo. Replace <repo folder> with the full path of your clone (a path without spaces), for
example C:\code\intern-intel or /home/you/intern-intel.

  Windows Task Scheduler (every day at 09:00), one line in a terminal:
    schtasks /Create /SC DAILY /ST 09:00 /TN "Intern Intel watch" /TR "<repo folder>\examples\intern-intel\.venv\Scripts\python.exe <repo folder>\examples\intern-intel\recipes\watch.py"

  cron on macOS or Linux (crontab -e, every day at 09:00):
    0 9 * * * cd <repo folder>/examples/intern-intel && .venv/bin/python recipes/watch.py >> out/watch.log 2>&1

  GitHub Actions. GitHub reads workflows only from the repo root, so the file is
  .github/workflows/watch.yml at the top of the repo, and its run steps use
  examples/intern-intel as their working folder. The cache path is written from the repo root,
  because the cache action does not use that working folder. Add BRIGHTDATA_API_TOKEN as a
  repository secret. Each run starts on a fresh machine, so the baseline is carried over with
  the cache action, saved under a new key every run and restored from the newest one:
    on:
      schedule: [{cron: "0 16 * * *"}]
      workflow_dispatch: {}
    jobs:
      watch:
        runs-on: ubuntu-latest
        defaults: {run: {working-directory: examples/intern-intel}}
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-python@v5
            with: {python-version: "3.12"}
          - run: pip install -r python/requirements.txt
          - uses: actions/cache@v4
            with: {path: examples/intern-intel/out/watch, key: "watch-${{ github.run_id }}", restore-keys: "watch-"}
          - run: python recipes/watch.py
            env: {BRIGHTDATA_API_TOKEN: "${{ secrets.BRIGHTDATA_API_TOKEN }}"}
"""

import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

import dedupe  # noqa: E402
import fetch  # noqa: E402
import intern_intel  # noqa: E402


def search_name(args):
    """'software engineer intern', 'San Francisco, CA', 2 -> 'software-engineer-intern--san-francisco-ca--p2'"""
    def slug(text):
        return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-") or "any"
    return f"{slug(args.role)}--{slug(args.location)}--p{args.pages}"


def load_rows(path):
    return json.loads(fetch.read_text(path)) if path.exists() else None


def new_listings(previous_rows, rows):
    """Rows whose key is not among previous_rows, in the order of rows."""
    seen = {r["key"] for r in previous_rows}
    return [r for r in rows if r["key"] not in seen]


def run(argv=None):
    args = intern_intel.parse_args(argv)
    if args.print_urls or args.from_dir or args.save_fixtures is not None:
        print("watch.py fetches the search itself: --print-urls, --from-dir and --save-fixtures do not apply.")
        return 2
    t0 = time.monotonic()
    watch_dir = intern_intel.OUT_DIR / "watch"
    baseline_path = watch_dir / f"{search_name(args)}.json"
    new_path = watch_dir / f"{search_name(args)}.new.json"
    previous = load_rows(baseline_path)

    _, pages, all_rows = intern_intel.fetch_rows(args)
    if not any(p.ok for p in pages):
        print("Nothing fetched. The saved listings are kept; try again later.")
        return 1
    complete = all(p.ok for p in pages)
    merged, shown = intern_intel.build_table(all_rows, args)
    intern_intel.write_outputs(shown)

    watch_dir.mkdir(parents=True, exist_ok=True)
    if complete:
        fetch.write_text(baseline_path, intern_intel.json_text(dedupe.sort_rows(merged)))
    else:
        print("Some pages failed, so the saved listings were not updated.")

    print()
    if previous is None:
        new = []
        shown_path = baseline_path.relative_to(ROOT) if baseline_path.is_relative_to(ROOT) else baseline_path
        print(f"First run for this search: saved {len(merged)} listings in {shown_path}."
              " Run it again later to see what is new.")
    else:
        new = new_listings(previous, shown)
        gone = len({r["key"] for r in previous} - {r["key"] for r in merged})
        print(f"{len(new)} new listings since the last run"
              f" ({len(merged)} listings now, {len(previous)} last time, {gone} no longer listed).")
        if new:
            print()
            intern_intel.print_table(new)
    fetch.write_text(new_path, intern_intel.json_text(new))
    print(f"Done in {time.monotonic() - t0:.1f} s.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(run())
