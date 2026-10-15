# Structured scrapers: Indeed and Glassdoor as JSON records

`cli/intern_intel.ps1` and `cli/intern_intel.sh` fetch search pages and parse them in Python.
Bright Data also runs pre-built scrapers that return records with named fields instead of a
page to parse. The Bright Data CLI calls them `pipelines`.

Everything below was run on 2026-10-15 with `@brightdata/cli@0.4.0` on our test laptop. The
times and outputs are from those runs.

## scrape or pipelines?

|                | `scrape` (what cli/intern_intel.* uses)  | `pipelines`                                         |
|----------------|------------------------------------------|-----------------------------------------------------|
| You get        | the search page as markdown; you parse it | JSON records with named fields                      |
| Time, our runs | 4 to 54 s per page, pages in parallel    | Glassdoor: about 3 minutes for 5 listings. Indeed: not finished after more than an hour |
| Location       | the site's own search for that location  | Glassdoor: all 5 listings were outside the Bay Area for "San Francisco" |
| Pay            | what the listing card shows              | Glassdoor: an annual estimate range                 |
| Extra fields   | none                                     | company rating, size, industry, benefits, review snippets |

Use `scrape` for the live demo and for anything a person is waiting on. Use `pipelines` for a
job that runs in the background, when the company fields are worth the wait, and check
`job_location` yourself.

## Before you start

Node.js 20 or newer, and your key in `BRIGHTDATA_API_KEY` for this terminal only (the CLI
reads that name). Do not do this on a projected screen.

```
$env:BRIGHTDATA_API_KEY = "<your key>"      # PowerShell
export BRIGHTDATA_API_KEY="<your key>"       # macOS, Linux, Git Bash
```

## 1. Find the scraper

```
npx -y @brightdata/cli@0.4.0 pipelines search glassdoor jobs
npx -y @brightdata/cli@0.4.0 pipelines search indeed jobs
```

Each took 2 to 3 seconds. The two job scrapers they found:

| Scraper ID              | Name                               | Methods                                          |
|-------------------------|------------------------------------|--------------------------------------------------|
| `gd_lpfbbndm1xnopbrcr0` | Glassdoor job listings information | collect_by_url, discover_by_keyword, discover_by_url |
| `gd_l4dx9j9sscpvs7no2`  | Indeed job listings information    | collect_by_url, discover_by_keyword, discover_by_url |

The first search saves the scraper list in the CLI's config folder
(`%APPDATA%\brightdata-cli\scrapers.json` on Windows).

## 2. See the input fields

```
npx -y @brightdata/cli@0.4.0 pipelines info gd_lpfbbndm1xnopbrcr0 discover_by_keyword
npx -y @brightdata/cli@0.4.0 pipelines info gd_l4dx9j9sscpvs7no2 discover_by_keyword
```

- Glassdoor, discover_by_keyword: `location` and `keyword` (required), `country`, `date_posted`.
- Indeed, discover_by_keyword: `country`, `domain`, `keyword_search` and `location` (required),
  `date_posted`, `posted_by`, `pay`, `location_radius`.

## 3. Start a run

Save the input as `glassdoor_input.json`:

```json
[{"location": "San Francisco", "keyword": "software engineer intern", "country": "US", "date_posted": ""}]
```

```
npx -y @brightdata/cli@0.4.0 pipelines run gd_lpfbbndm1xnopbrcr0 discover_by_keyword --input "@glassdoor_input.json" --limit-per-input 5 --async
```

It printed this in 4.3 seconds:

```
Starting discover_by_keyword on gd_lpfbbndm1xnopbrcr0 for 1 input(s)...
{"snapshot_id":"sd_mv9o9af1whg9bhtwx"}
Check: brightdata pipelines status sd_mv9o9af1whg9bhtwx
```

- Keep the quotes around `"@glassdoor_input.json"`. PowerShell treats a bare `@` as special.
- `--limit-per-input` caps the records per input. The CLI help says every record is billed,
  so keep it small while you try things.
- `--async` returns the snapshot ID right away. We used it for every run; to wait in the
  foreground instead, see `pipelines run --help`.

## 4. Check on it

```
npx -y @brightdata/cli@0.4.0 pipelines status sd_mv9o9af1whg9bhtwx
```

Checked 2 minutes 44 seconds after the start, it still said `"status":"running"` with
`"running_time":167551` (milliseconds). Checked again later:

```
{"status":"ready","snapshot_id":"sd_mv9o9af1whg9bhtwx","dataset_id":"gd_lpfbbndm1xnopbrcr0","error_codes":{"aborted_page":1},"records":5,"errors":1,"collection_duration":181571,"avg_duration_per_input":181571}
```

`collection_duration` is in milliseconds: the run took about 3 minutes.

## 5. Get the records

```
npx -y @brightdata/cli@0.4.0 pipelines results sd_mv9o9af1whg9bhtwx --format json -o glassdoor_results.json
```

3.4 seconds, 37,601 bytes. The file is a JSON array of 6 entries: 5 listings, and 1 entry with
an `error` key (`"error_code": "aborted_page"`) and no listing. Skip entries that have an
`error` key.

Reading it in Python:

```python
import json

records = json.load(open("glassdoor_results.json", encoding="utf-8"))
for r in records:
    if "error" in r:
        print("skipped:", r["error_code"], "-", r["error"])
        continue
    print(r["job_title"], "|", r["company_name"], "|", r["job_location"], "|",
          r["pay_range_glassdoor_est"], r["pay_range_currency"], r["pay_type"])
    print("   work/life", r["company_work/life_balance_rating"],
          "| would recommend", r["percentage_that_recommend_company_to_a friend"])
```

First lines of its output:

```
skipped: aborted_page - Crawl aborted on job cancel
Undergraduate Software Developer Intern | Applied Research Associates | Raleigh, NC | 67033 - 88666 USD ANNUAL
   work/life 2.8 | would recommend 0.42
```

## What came back (Glassdoor)

- Each listing had 36 to 38 fields. Across the 5: `url`, `job_title`, `company_name`,
  `job_location`, `job_overview`, `job_posting_id`, `job_application_link`,
  `pay_median_glassdoor`, `pay_range_glassdoor_est`, `pay_range_currency`, `pay_type`,
  `company_rating`, `company_size`, `company_industry`, `company_sector`, `company_type`,
  `company_founded_year`, `company_headquarters`, `company_revenue`, `company_website`,
  `company_ceo`, `company_id`, `company_url_overview`, the `company_*_rating` fields,
  `company_benefits_employer_summary`, `employee_benefit_reviews`,
  `reviews_by_same_job_pros`, `reviews_by_same_job_cons`, `percentage_that_approve_of_ceo`,
  `percentage_that_recommend_company_to_a friend`, `discovery_input`, `input`, `timestamp`.
- Two names contain a `/` or a space, so read them with brackets, not dot access:
  `r["company_work/life_balance_rating"]` and `r["percentage_that_recommend_company_to_a friend"]`.
- Location: the input said San Francisco. The 5 listings were in Raleigh NC, Cary NC, Auburn
  Hills MI, Boulder CO and Tulsa OK. Filter on `job_location` yourself.
- Pay: `pay_type` was `ANNUAL` on all 5, with `pay_range_glassdoor_est` such as
  `"67033 - 88666"` and `pay_median_glassdoor` such as `77094`. The field names mark them as
  Glassdoor estimates, not the pay on the posting.
- The fields that line up with Intern Intel's columns are `job_title` (title), `company_name`
  (company), `job_location` (location) and `url`.

## Indeed

Two Indeed discover_by_keyword runs (`gd_l4dx9j9sscpvs7no2`) started on 2026-10-15, with limits
of 5 and 10 records, still said `"status":"running"` after 68 and 77 minutes, with no records.
We did not get Indeed records from this path, so Intern Intel fetches Indeed with `scrape`.
