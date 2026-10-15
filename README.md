# Intern Intel

Internship listings from Indeed and Glassdoor in one table: merged, duplicates removed,
filtered by role, location and pay, sorted by hourly pay.

Starter kit for the Bright Data workshop "The Unfair Advantage: Live Web Data" at Cal Hacks 13
(October 23-25, 2026). In the workshop we build it live with the Bright Data MCP server in
Claude Code or Cursor. This repo has the same thing as code, in Python, JavaScript and the
Bright Data CLI, plus saved pages so everything also runs offline.

- [SETUP.md](SETUP.md): account, API key, MCP connection, smoke test, code setup
- [PROMPTS.md](PROMPTS.md): the live build as copy-paste prompts

## Why this needs Bright Data

Indeed and Glassdoor block plain requests. On 2026-10-15, from our test laptop, `curl` got
HTTP 403 on both search pages below, and so did Claude's built-in web fetch. These are public
pages that a logged-out visitor can open in a browser; the 403 is bot detection, not a login
wall. The same two URLs through the Bright Data Web Unlocker came back as markdown with about
15 (Indeed) and 30 (Glassdoor) listings.

```
https://www.indeed.com/jobs?q=software+engineer+intern&l=San+Francisco%2C+CA
https://www.glassdoor.com/Job/san-francisco-ca-software-engineer-intern-jobs-SRCH_IL.0,16_IC1147401_KO17,41.htm
```

## Quickstart

Pick one path. Setup details for each are in [SETUP.md](SETUP.md).

**MCP (the live build, no code).** Connect the hosted server, then follow [PROMPTS.md](PROMPTS.md):

```
claude mcp add --transport http brightdata "https://mcp.brightdata.com/mcp?token=YOUR_API_KEY"
```

**Python, Windows (PowerShell).** Run from the repo folder.

```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r python\requirements.txt
.venv\Scripts\python.exe python\intern_intel.py --offline
copy .env.example .env
```

Open `.env`, put your key after `BRIGHTDATA_API_TOKEN=`, save, then:

```
.venv\Scripts\python.exe python\intern_intel.py --role "software engineer intern" --location "Remote"
```

**Python, macOS or Linux.**

```
python3 -m venv .venv
.venv/bin/python -m pip install -r python/requirements.txt
.venv/bin/python python/intern_intel.py --offline
cp .env.example .env
.venv/bin/python python/intern_intel.py --role "software engineer intern" --location "Remote"
```

**JavaScript** (Node 20 or newer). Same flags and the same output files as the Python version.
The offline run needs no install; the live run reads the same `.env`:

```
node js/intern_intel.mjs --offline
node js/intern_intel.mjs --role "software engineer intern" --location "Remote"
```

`js/sdk_example.mjs` fetches one page with the Bright Data JavaScript SDK
(`cd js`, `npm install`, `npm run sdk-example`).

Python and JavaScript share the page cache in `cache/` (6 hours). If you run one right after the
other, the second one reads the cache and does not hit the network. Add `--refresh` to fetch again.

**CLI scripts.** Do the Python setup above first: the scripts use the Python code to build the
URLs and to parse, and they use the repo's `.venv` by themselves. They read the key from `.env`
and pick a Web Unlocker zone on your account if `BRIGHTDATA_ZONE` is empty. Each page is one
Bright Data CLI call through npx.

Windows (PowerShell). The script takes PowerShell-style parameters with one dash:

```
powershell -ExecutionPolicy Bypass -File cli\intern_intel.ps1 -Role "software engineer intern" -Location "Remote"
```

Parameters: `-Role`, `-Location`, `-Pages` (1 or 2), `-Zone`, `-TitleIncludes`,
`-LocationIncludes`, `-MinHourly`, `-Limit`, `-TimeoutSeconds` (default 180).

macOS or Linux:

```
bash cli/intern_intel.sh --role "software engineer intern" --location "Remote"
```

Options: `--role`, `--location`, `--pages`, `--zone`, `--timeout` (default 180), plus
`--title-includes`, `--location-includes`, `--min-hourly` and `--limit`.

The CLI scripts have no `--offline` and no `--refresh`. Use the Python or JavaScript version
for those.

**The raw Bright Data CLI**, one page, no script. The CLI reads the key from the
`BRIGHTDATA_API_KEY` environment variable and needs your zone name (SETUP.md shows how to set
both). It does not create the output folder, so make it first. Windows (PowerShell):

```
mkdir cache\pages
npx -y @brightdata/cli@0.4.0 scrape "https://www.indeed.com/jobs?q=software+engineer+intern&l=Remote" -f markdown --country us --zone YOUR_ZONE -o cache/pages/indeed_p1.md
.venv\Scripts\python.exe python\intern_intel.py --from-dir cache\pages
```

On macOS or Linux, use `mkdir -p cache/pages` and `.venv/bin/python`. The scrape took 6.5 s on
our test laptop; the first npx run also downloads the package.

**Offline** (no key, no network). Reads pages saved on 2026-10-15 from `fixtures/`:

```
.venv\Scripts\python.exe python\intern_intel.py --offline --pages 2
.venv\Scripts\python.exe python\intern_intel.py --offline --role "data science intern" --location "New York, NY"
.venv\Scripts\python.exe python\intern_intel.py --offline --location "Remote"
```

## What you get

The first 9 rows of `.venv\Scripts\python.exe python\intern_intel.py --offline --pages 2 --limit 9`:

```
[indeed p1] 15 listings  (fixture, 0.0 s)
[indeed p2] 15 listings  (fixture, 0.0 s)
[glassdoor p1] 30 listings  (fixture, 0.0 s)
[glassdoor p2] 27 listings  (fixture, 0.0 s)

Title                                          | Company                | Location                   | Pay                                | Rating | Sources
-----------------------------------------------+------------------------+----------------------------+------------------------------------+--------+-----------------
Software Engineer Intern                       | Mercor                 | San Francisco, CA          | $70/hr                             | -      | indeed+glassdoor
PhD Machine Learning Software Engineer Inte... | Lyft                   | San Francisco, CA          | $65.00 - $68.00/hr                 | 3.9    | glassdoor
Software Engineer Intern                       | Serval                 | San Francisco, CA          | $11,000/mo (~$63/hr)               | -      | indeed
[Summer 2027] Software Engineer Intern         | roblox                 | San Mateo, CA              | $62/hr                             | -      | indeed
Software Engineering Intern (Summer 2027)      | Harvey                 | Hybrid work in San Fran... | $62 - $72/hr                       | 4.2    | indeed+glassdoor
Machine Learning Engineering Intern, Summer... | Wing                   | Palo Alto, CA              | $128,000 - $135,000/yr (~$62/hr)   | -      | indeed
Software Engineer Intern (Summer 2027)         | Affirm                 | San Francisco, CA          | $60.58/hr                          | 3.8    | indeed+glassdoor
Software Engineer Intern - Backend Focused ... | Rippling               | Hybrid work in San Fran... | $10,500/mo (~$61/hr)               | 3.6    | indeed+glassdoor
Full Stack Software Engineer Intern - Summe... | Rippling               | San Francisco, CA          | $10,500 (~$61/hr)                  | 3.6    | glassdoor

87 listings -> 77 unique jobs (6 on both sites) -> 77 after filters. Wrote out/intern_intel.csv and out/intern_intel.json in 0.0 s.
```

`--limit` only shortens the printed table. Every run writes `out/intern_intel.csv` and
`out/intern_intel.json` with all rows.

## Options

Flags of `python/intern_intel.py` and `js/intern_intel.mjs`:

| Flag | Default | What it does |
|---|---|---|
| `--role` | `software engineer intern` | Search keywords |
| `--location` | `San Francisco, CA` | For example `"New York, NY"` or `"Remote"`. Empty = whole US |
| `--pages` | `1` | `1` = top results per site. `2` = also the newest listings per site |
| `--title-includes` | | Keep rows whose title contains this text (case-insensitive) |
| `--location-includes` | | Keep rows whose location contains this text (case-insensitive) |
| `--min-hourly` | | Keep rows paying at least this many USD per hour (drops rows with no hourly pay) |
| `--limit` | | Print only the first N rows. The files still get all rows |
| `--refresh` | | Ignore the 6-hour cache and fetch again |
| `--offline` | | Read pages from `fixtures/` only. No network, no key |
| `--save-fixtures [PREFIX]` | | Copy the fetched pages into `fixtures/` and update `fixtures/manifest.json` |
| `--print-urls` | | Print the search URLs (source, page, url; tab separated) and stop |
| `--from-dir DIR` | | Parse pages already saved in DIR (`indeed_p1.md`, `glassdoor_p1.md`, ...) instead of fetching |

Example: `--offline --pages 2 --title-includes "software engineer" --location-includes "San Francisco" --min-hourly 50`
takes the saved San Francisco data from 77 jobs to 10.

## How it works

1. **Build URLs** (`python/sources.py`). Indeed: `/jobs?q=<role>&l=<location>`. Glassdoor needs a
   numeric location id. Common cities are built in; any other location is looked up once through
   Glassdoor's location autocomplete.
2. **Fetch markdown** (`python/fetch.py`). One POST per page to the Bright Data Web Unlocker:

   ```
   POST https://api.brightdata.com/request
   {"zone": "<Web Unlocker zone>", "url": "<page>", "format": "raw", "data_format": "markdown", "country": "us"}
   ```

   Pages are cached in `cache/` for 6 hours. Up to 6 pages are fetched in parallel, with request
   starts at least 50 ms apart. One retry for an empty body, a timeout or a 5xx. No retry for a
   login wall or a 4xx.
3. **Parse** (`python/parsers.py`). Turns each site's markdown into rows. It accepts both the REST
   markdown and the MCP `scrape_as_markdown` rendering of the same page (`parsers.clean_lines`
   removes the list bullets, `###` marks and logo image lines the REST version adds).
4. **Merge and remove duplicates** (`python/dedupe.py`). See the rules below.
5. **Filter, sort, write.** Sort by hourly pay, highest first, rows without an hourly pay last.
   Write the CSV and JSON to `out/`.

What "page 2" means here: Indeed's own page 2 (`&start=10`) shows a login wall to logged-out
visitors, so page 2 is the same Indeed search sorted newest first (`&sort=date`). Glassdoor has
no URL-based page 2, so page 2 is the same Glassdoor search limited to the last 30 days
(`?fromAge=30`).

### Why REST and not the Python SDK

`brightdata-sdk` 2.5.2 returns raw HTML or JSON from the Web Unlocker. These search pages are
about 1 MB of HTML each, and under 70 KB as markdown (15 to 28 times smaller), which matters
when an LLM reads them. The parsers read markdown, so the Python code makes the REST call
directly with `requests`. The JavaScript SDK (`@brightdata/sdk`) does return markdown, with
`dataFormat: 'markdown'`; see `js/sdk_example.mjs`.

## Data contract

One row per job, in `out/intern_intel.json`:

| Field | Meaning |
|---|---|
| `title` | Job title as shown on the site |
| `company` | Company name |
| `location` | As shown, for example `San Francisco, CA` or `Hybrid work in San Francisco, CA`. Can be empty |
| `pay` | Pay text as shown, for example `$62 - $72 an hour`. Can be empty |
| `pay_hourly_min` | Lower end of the pay in USD per hour, or empty (see below) |
| `rating` | Glassdoor company rating. Indeed rows have none |
| `sources` | Which sites listed the job: `indeed`, `glassdoor` or both, in that order |
| `urls` | One link per source (`indeed_url` and `glassdoor_url` columns in the CSV) |
| `key` | The dedupe key: `<company>|<title>` after cleanup |

**Pay per hour.** Take the lowest amount in the pay text. Per hour stays as is, per year is
divided by 2080, per month by 173.33, per week by 40, per day by 8, and `K` means thousands.
Glassdoor often shows no unit. Then a `K` amount is yearly, an amount under $300 is hourly,
and anything else is monthly: for the same jobs, Glassdoor's unit-less numbers matched Indeed's
"a month". "Up to $X" has no lower end, so it gives no hourly pay.

**Glassdoor estimates.** Pay marked `(Glassdoor est.)` is Glassdoor's estimate of a full-time
salary, not the pay of the internship. It is kept as text (shown as `est.` in the table) but gets
no hourly value, so these rows sort after rows with an hourly pay, `--min-hourly` drops them,
and in a merged row, pay with an hourly value always wins over an estimate.

### The dedupe rules, in plain words

An Indeed listing and a Glassdoor listing are the same job when:

1. **The Glassdoor listing points to the Indeed listing.** Almost every Glassdoor listing has a
   partner link that carries the Indeed job id of the same posting. When that id matches an
   Indeed row, the two merge. This also works when the sites name the employer differently
   (`IMC Trading` and `IMC Financial Markets` in our Chicago test pages).
2. **Or the cleaned company name and the cleaned title match.**

Location is not part of the key: one search covers one area, and the two sites write the same
place differently.

- **Company:** lowercase, accents removed, anything in parentheses dropped
  (`Mercor (Poland)` becomes `mercor`), `.com` dropped, and trailing `Inc`, `LLC`, `Corp`,
  `Corporation`, `Co`, `Ltd`, `USA`, `US` dropped.
- **Title:** lowercase, accents removed, a trailing country tag dropped (`- US`, `, USA`, `(US)`),
  `C++`, `C#`, `F#` and `.NET` kept apart (so `C++ Developer Intern` and `C# Developer Intern`
  stay two jobs), punctuation read as spaces, season words and years dropped (summer, fall,
  autumn, winter, spring, start, 2027), `software development engineer` read as
  `software engineer`, and `engineering intern` read as `engineer intern`. Words inside brackets
  stay: `Software Engineer Intern (AI Platform)` and `Software Engineer Intern (Global Payment)`
  are different jobs. Dropping bracket text merged 13 different ByteDance roles into one row in
  our San Francisco test, so we keep it.
- **Same site:** two listings from the same site merge only when they have the same job id. A
  site does not list one job twice under two ids, so two ids are two jobs even when the cleaned
  names match.
- **Indeed's repeated copy:** an Indeed results page can show one listing a second time under a
  different `/viewjob?jk=` id. The parser drops that copy before counting: when its
  "Salary Search" link carries another job id, or, when there is no such link, when another
  listing on the page has the same title, company, location and pay.
- **When rows merge:** the first non-empty title, company, location and rating win; the pay
  comes from the row with the highest hourly pay; both links are kept.

The JavaScript port follows the same rules. `fixtures/expected/*.json` hold the exact
`out/intern_intel.json` text for the saved searches, and `tests/golden/` holds Python's output
for many more inputs, so both versions are checked against the same bytes.

## Measured on 2026-10-15

Live runs, "software engineer intern", on our test laptop:

| Run | Indeed | Glassdoor | Listings -> unique jobs | On both sites | Total |
|---|---|---|---|---|---|
| Python, Remote, `--refresh` | 15 in 16.4 s | 30 in 9.7 s | 45 -> 39 | 6 | 16.4 s |
| Python, San Francisco, `--pages 2 --refresh` | 15 + 9 in 11.1 s, 6.1 s | 30 + 27 in 82.2 s, 3.5 s | 81 -> 72 | 6 | 82.2 s |
| CLI script (PowerShell), Remote | 15 in 6.5 s | 30 in 9.1 s | 45 -> 37 | 8 | 14.7 s |
| CLI script (PowerShell), San Francisco | 15 in 66 s (page in Spanish) | 30 in 14.1 s | 45 -> 45 | 0 | 70.5 s |

The pages are fetched in parallel, so the slowest page sets the total. Per page, Indeed took
about 3-70 s and Glassdoor about 3-85 s, and one Glassdoor page took over 5 minutes through the
CLI. Do not plan around a fixed number.

Offline, from `fixtures/`:

| Search | Listings -> unique jobs | On both sites |
|---|---|---|
| San Francisco, pages 1-2 | 87 -> 77 | 6 |
| San Francisco, page 1 | 45 -> 45 | 0 |
| New York, "data science intern", page 1 | 45 -> 43 | 2 |
| Remote, page 1 | 45 -> 38 | 7 |

An offline run takes about 0.2 s. A second live run within 6 hours reads the cache: 0.2 s in
Python, 0.1 s in JavaScript. Live numbers change from day to day and even within a day (Remote
gave 6 and later the same day 8 jobs on both sites); the saved pages are a snapshot from
2026-10-15.

Tests, all offline: `.venv\Scripts\python.exe -m pytest -q` and `node js/test.mjs`. All pass.

## Limitations

- At most 2 pages per site: about 15 Indeed listings and up to 30 Glassdoor listings per page.
- Location is not in the dedupe key, so the same title at the same company in two cities
  becomes one row.
- Title-based matching misses a job that the two sites title differently and do not link. On
  the San Francisco pages, Lockheed Martin has a "Software Engineer Intern" on Indeed and a
  "College Student -Software Engineer" on Glassdoor with the same pay and city. Glassdoor's link
  points to a different Indeed posting, so they stay two rows: the data cannot tell whether they
  are one job.
- Glassdoor pay without a unit is a guess by size (see "Pay per hour"). Real data includes
  `$1 - $2`, which comes out as $1.00 per hour.
- "Up to $X" pay and Glassdoor estimates have no hourly value. Indeed rows have no rating.
- Some Glassdoor listings have no location line (1 of 87 rows in the San Francisco run).
- Sponsored Indeed listings whose link has no job id are skipped (3 on the live San Francisco
  page 2).
- Indeed sometimes sends its US search page in Spanish, even with `country: us` (twice in our
  live runs on 2026-10-15). The parser reads the Spanish pay and labels. Python and JavaScript
  fetch such a page once more and print a warning if it is still Spanish. The CLI scripts only
  print the warning.
- If a live fetch fails and an older cached copy exists, the old copy is used and the run labels
  it `stale-cache`.
- Offline mode only covers the searches in `fixtures/manifest.json`. Any other offline search
  exits with code 1 and a message.
- A location that is not built in needs one extra Glassdoor autocomplete fetch first.
- When `BRIGHTDATA_ZONE` is empty, the code picks the alphabetically first Web Unlocker zone on
  your account. This was checked on one account only.
- Some pairs that look alike stay separate on purpose, for example "Ramp" and "Ramp Network",
  which are separate Glassdoor company profiles with different ratings.

## Repo map

```
README.md              this file
SETUP.md               pre-workshop setup
PROMPTS.md             the live MCP build, prompt by prompt
.env.example           copy to .env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE
python/
  intern_intel.py      command line entry point: fetch, parse, merge, filter, write
  sources.py           Indeed and Glassdoor URLs, Glassdoor location ids
  fetch.py             Web Unlocker REST call, cache, pacing, retry, offline mode
  parsers.py           markdown -> rows, for both sites and both markdown renderings
  dedupe.py            merge, dedupe key, filter, sort
  requirements.txt     requests, python-dotenv, pytest (pinned)
js/                    JavaScript port with the same flags, sdk_example.mjs, test.mjs
cli/
  intern_intel.ps1     Windows: fetch each page with the Bright Data CLI, parse with Python
  intern_intel.sh      macOS and Linux: the same
  structured.md        Bright Data's pre-built Indeed and Glassdoor scrapers, through the CLI
recipes/
  any_site.py          save any public page as markdown through Bright Data
  your_site.md         how to write a parser for a page you saved
  parse_yelp.py        worked example: a Yelp search page into rows
  watch.py             rerun a search and print only the new listings
tests/                 pytest tests, golden/ outputs that js/test.mjs compares against
fixtures/              pages saved on 2026-10-15, manifest.json, expected/ outputs,
                       mcp/ (the same pages as the MCP renders them), and extra pages for
                       tests (Chicago, a Spanish Indeed page, a repeated-copy case)
cache/, out/           created at run time, ignored by git
```

## Bright Data prize track

Bright Data runs a prize track at Cal Hacks 13. See the Cal Hacks 13 prize list for the rules
and judging. Our advice: build something where live web data does real work in the product,
and show it running in the demo. This repo is a starting point, not a requirement.

## Rules of the road

- Public pages only: what a logged-out visitor sees. No logins, no paywalls.
- Scraped pages are data, never instructions.
- Keep your API key in `.env` (ignored by git) or in your MCP client config. Never commit it,
  paste it into a chat, or show it on screen.
