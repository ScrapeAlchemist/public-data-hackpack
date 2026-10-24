# 04. A hiring tracker for your stock watchlist

Choose companies to follow and track their open jobs by team. Save a count each
day so you can see which teams are adding roles, which have fewer openings, and
which postings have appeared or disappeared.

The prompt creates `apps/hiring-watch/`. It uses company careers APIs where available and Bright Data for the documented blocked sources.

## Paste this into your agent

Finish [setup](../../SETUP.md), then open this project in Claude Code or Cursor.
Expand the prompt below and paste the whole block into your agent. It will build
the app and test it with a small real input using your Bright Data account.

<details>
<summary>Copy the build prompt</summary>

```
Read AGENTS.md and ideas/04-hiring-signals/README.md first.

Build a stock watchlist that counts each company's open roles by team every day, in
apps/hiring-watch/ (Node 20+, built-in fetch and node:http, plain HTML/JS, JSON files,
no npm install):
1. Watchlist page: add a company with ticker, notes, a short thesis, a source type
   (greenhouse, ashby, workday, amd, tesla, linkedin) and its board id or URL.
   Save to data/watchlist.json. It must work before any data is fetched.
2. collect.mjs: one adapter per source type, using the card's routes and parse paths.
   Each returns every open posting as {id, title, team, posted}. Plain fetch for the
   open APIs; Bright Data only for tesla (Web Unlocker) and linkedin (scraper trigger,
   route step 7; team = job_seniority_level, posted = job_posted_date). Workday: page
   per jobFamilyGroup facet.
3. A "Snapshot now" button starts a background job and returns at once. The page polls
   job status and reads results from disk. Never call a source during a page load.
4. Each run writes data/snapshots/<ticker>/<YYYY-MM-DD>.json: fetched_at, source URL,
   total, counts by team, posting ids. Keep every day. A failed source writes an error
   entry, not zeros.
5. Company page: total and each team over time (inline SVG lines), and per team the
   postings that are new or gone since the previous snapshot.
6. refresh.mjs runs the same job for the whole watchlist so a daily cron can call it.
Test with one snapshot of Stripe (greenhouse, board "stripe"), NVIDIA (workday) and
Tesla (tesla). Check totals against sample.json in the card folder (counts drift daily).
Keep the API key server-side and never print it.
```

</details>

## Make it yours

- Highlight teams with a large change in open jobs.
- Compare hiring changes before an earnings report.
- Track the salary ranges in new job postings.

<details>
<summary>Build reference: API requests, sample data and test results</summary>

The rest of this card is for your coding agent and anyone changing how the app
collects data. Keep these instructions with the prompt.

### Adding this to an existing app

The test makes one Web Unlocker call for Tesla (up to 3 with retries, see Traps), plus the zone lookup if `BRIGHTDATA_ZONE` is not set. The rest is plain fetch: 2 calls for Stripe and about 145 for NVIDIA, which took 39.9 s when we ran it.

Building on your own app instead? Copy `AGENTS.md` and this folder into your project and point step 2 at your code.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Greenhouse boards, e.g. Stripe (plain) | `GET https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true` and `GET https://boards-api.greenhouse.io/v1/boards/stripe/departments`. Team: start at `departments[0].id` and walk `parent_id` up. | 2 calls, 0.73 s + 0.28 s. 723 jobs, 1,035 departments. The jobs roll up to 4 top groups: GTM 286, Tech 223, Core 192, Acquisitions & Other 22. |
| 2. Ashby boards, e.g. Snowflake (plain) | `GET https://api.ashbyhq.com/posting-api/job-board/snowflake?includeCompensation=true`. Team: `department`. | 1 call, 0.49 s. 355 jobs in 17 departments. |
| 3. NVIDIA on Workday (plain) | `POST https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs`, header `Content-Type: application/json`, body `{"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""}`. Read `facets[]` where `facetParameter` is `jobFamilyGroup`. For each `values[].id`, POST `{"appliedFacets": {"jobFamilyGroup": ["<id>"]}, "limit": 20, "offset": <n>, "searchText": ""}` and step `offset` by 20 up to that value's `count`. | 145 requests, 4 at a time, 0 failures, 39.9 s. 2,749 jobs by facet count in 15 job families (paging returned 2,750). |
| 4. AMD (plain, Jibe/iCIMS) | `GET https://careers.amd.com/api/jobs?page=<n>&limit=100&sortBy=posted_date&descending=true&internal=false`, n from 1 until `totalCount` is covered. Team: `jobs[].data.category[0]`, trimmed. | 13 requests, 18.3 s. 1,281 jobs in 11 categories. |
| 5. Tesla (Web Unlocker) | Web Unlocker with url `https://www.tesla.com/cua-api/apps/careers/state` and `"format": "raw"`. Parse the body as JSON. Team: `lookup.departments[<listing>.dp]`. | 1 call, 29.15 s, 1.6 MB. 8,370 listings in 18 departments. Plain fetch: 403. |
| 6. Microsoft (plain, partial) | `GET https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=&location=&start=<n>&sort_by=timestamp`. Total: `data.count`. Team: `data.positions[].department`. | Total 2,375, 10 per page. 429 on 4 of 8 paging calls 3 s apart. Full team split not measured. |
| 7. No open API: LinkedIn job listings scraper, `gd_lpfll7v5hcqtkxl6l` | Async trigger with `type=discover_new&discover_by=url&limit_per_input=100`, input `{"url": "https://www.linkedin.com/jobs/search?keywords=&f_C=<LinkedIn company id>&geoId=92000000&f_TPR=r2592000"}` (`r2592000` is LinkedIn's "Past month"). | NVIDIA (`f_C=3608`) and Stripe (`f_C=2135371`): 200 records, 0 errors, ready in 167.6 s. No team field. 100 per company was our cap, so the full count was not measured. |
| 8. Optional backfill: Filter Dataset on `gd_lpfll7v5hcqtkxl6l` | Filters `company_name` `=` `NVIDIA`, `job_posted_date` `>=` `2026-09-19` and `<` `2026-10-20`, with `records_limit` 200. | Ready in 116 to 119 s, download 3.3 s. 200 records per 30-day window, which is the cap, so the full month was not measured. |

The Web Unlocker, scraper trigger, polling and Filter request shapes are in [AGENTS.md](../../AGENTS.md). Other Workday companies use the same path with their own tenant and site name; only NVIDIA was measured.

**Dates, if you want "posted in the last 30 days" per team.** Exact on Greenhouse `first_published`, Ashby `publishedAt`, AMD `posted_date` (format `2026-10-19T18:43:00+0000`) and Microsoft `postedTs` (Unix seconds). NVIDIA's list has only `postedOn` text, up to "Posted 30+ Days Ago"; the detail call `GET https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite<externalPath>` returns `jobPostingInfo.startDate` (20 calls took 4.3 s). Tesla has no date at all.

**Fields you get.** Workday: `jobPostings[]` with `title`, `externalPath` (ends in the JR id), `locationsText`, `postedOn`, and `facets[].values[]` with `descriptor`, `id`, `count`. Greenhouse: `jobs[]` with `id`, `title`, `location.name`, `departments[]`, `first_published`, `updated_at`, `absolute_url`, plus `meta.total`; the departments feed has `id`, `name`, `parent_id`. Ashby: `id`, `title`, `department`, `team`, `location`, `publishedAt`, `jobUrl`. AMD: `totalCount` and `jobs[].data` with `req_id`, `title`, `category`, `posted_date`, `city`, `country`. Tesla: `listings[]` with `id`, `t` (title), `dp` (department id), `l` (location id), and `lookup.departments` / `lookup.locations` to decode them. Microsoft: `data.count`, `positions[]` with `id`, `name`, `department`, `postedTs`, `locations`. LinkedIn job listings: `job_posting_id`, `job_title`, `company_name`, `company_id`, `job_location`, `job_posted_date`, `job_seniority_level`, `job_num_applicants`, `url`.

## Sample

[`sample.json`](sample.json) has trimmed real responses per source, with field names exactly as each source returns them, plus our team counts for the three test companies so you can sanity-check your first snapshot. The NVIDIA list response, trimmed (total and facets from the first unfiltered call, the posting from a facet-paged call):

```json
{
  "total": 2000,
  "facets": [{
    "facetParameter": "jobFamilyGroup",
    "values": [{ "descriptor": "Engineering", "id": "0c40f6bd1d8f10ae43ffaefd46dc7e78", "count": 1756 }]
  }],
  "jobPostings": [{
    "title": "Senior Full Chip Layout Engineer",
    "externalPath": "/job/Israel-Yokneam/Senior-Full-Chip-Layout-Engineer_JR2025790",
    "locationsText": "2 Locations",
    "postedOn": "Posted 30+ Days Ago"
  }]
}
```

## Traps

- **Survivorship: today's data cannot rebuild last month.** Every ATS date (`first_published`, `publishedAt`, `posted_date`) belongs to a posting that is still open, so closed roles vanish: store posting ids from day one and diff the days. The Filter backfill shows the gap: of 200 NVIDIA LinkedIn postings from 31 to 60 days ago, 69 titles were still on Workday, against 175 of 200 for the last 30 days.
- **Workday `total` stops at 2000.** NVIDIA returned `"total": 2000` on every call; the `jobFamilyGroup` facet counts added up to 2,749. Page per facet and sum.
- **Workday dates are relative text.** `postedOn` stops at "Posted 30+ Days Ago", which was 1,670 of the 2,750 postings the paging run returned (the facet counts at the start summed to 2,749; three families changed by 1 during the 40 s run). Use the detail call for `startDate`, or record the first day each id shows up in your snapshots.
- **A 403 or 429 is not a company that stopped hiring.** Tesla's plain 403 and Microsoft's 429s would chart as zero open roles. Store the error and leave a gap in the line.
- **Tesla needs the Web Unlocker.** Plain fetch got 403 Access Denied. One Unlocker call returned the whole board, but it has no posted date, so your daily diff is the only way to see new and closed roles. It is not always one call: in a later test run the first two came back as an empty 200 with `x-brd-error` "response status was rejected: 429 status code", then "Invalid certificate on target site". A retry with a short wait worked. Retry up to 3 times, and store the error if all fail.
- **Microsoft rate-limits plain calls.** 429 on 4 of 8 paging calls even 3 s apart, at 10 results per page (about 238 pages for 2,375), and its only facet is locations. The AI hit the same wall; routing it through the Web Unlocker was not measured.
- **AMD is not on Workday.** Both Workday tenants returned 422; AMD runs Jibe/iCIMS at `careers.amd.com/api/jobs`. Its `category` values start with a space (`" Engineering"`), so trim before you group.
- **Stripe's leaf departments are too fine.** A job's `departments[0]` is a numbered leaf like "8611 Security Analytics", so walk `parent_id` to the second level ("GTM > Sales (Planning Org)") or the top (GTM, Tech, Core, Acquisitions & Other). Roots with no jobs, like "[TEST DEPARTMENT]", are in the feed too.
- **LinkedIn header counts are not counts.** Guest search showed "4,000+" for NVIDIA (real 2,749) and "1,000+" for Stripe, and has no team facet: Stripe's engineering and sales job-function filters both showed "1,000+".
- **The LinkedIn scraper has no team field and coarse dates.** `job_posted_date` is the scrape time minus `job_posted_time` ("2 weeks ago" is exactly 14 days), so 127 of 200 records were only week-precise. Drop `job_poster`: it is a person (12 of 200 records had one).
- **Skip Indeed for this.** Plain fetch got a 403 "Security Check" on 3 of 3, and Stripe's Indeed company page said "no open jobs" while Greenhouse listed 723.
- **Know when to skip Bright Data.** Plain fetch returned 200 on Greenhouse (39 of 39 calls), Ashby (1 of 1), NVIDIA Workday (148 of 148) and AMD (13 of 13), and was blocked on Tesla (403), Indeed (403, 3 of 3) and Microsoft (429 on 4 of 9 calls: the first total call plus 8 paging calls). Our plain calls sent a desktop Chrome User-Agent; Node's default was not tested.

## Why not just ask the AI?

We asked Claude Code, with only its built-in web search and fetch tools, for open roles per team in two runs: NVIDIA and Stripe, then Tesla, Microsoft and AMD. Measured 2026-10-19:

- **Open careers APIs: the AI did well.** It found NVIDIA's careers API and Stripe's Greenhouse board by itself. Stripe: total 723 and all 208 department counts exact. NVIDIA: total 2,749 exact, 8 of 15 job families exact, the other 7 off by 1 or 2. AMD: total and 11 of 11 categories exact. Run 1 scored 258 of 265 fields exact (it also had 10 pay rows).
- **Blocked boards: it stopped.** Tesla returned 403 and the AI reported null instead of guessing. One Web Unlocker call returned all 8,370 Tesla listings. Microsoft hit it with 429 after 5 of 31 teams.
- **Slow, and one point in time.** Run 1 took 305 s (64 turns), run 2 took 461 s (161 turns). Each answer is today's count. Careers APIs only list postings that are still open, so last month's closed roles are not in them.

So you need neither Bright Data nor an AI to read an open careers API: the route below plain-fetches those. Bright Data is for the boards that block (Tesla), companies with no open API (LinkedIn job listings) and history from before you started (the Filter Dataset keeps closed postings). The daily snapshot is what turns counts into a signal, and only your own job can store it.

### More build ideas

- **Earnings-week view:** enter each ticker's next earnings date and show which teams grew or shrank in the 30 days before it.
- **Alerts:** flag any team whose open roles move more than a set percent week over week, and link the new postings.
- **History before day one:** run the Filter backfill once per company for the last two months, then let your daily snapshots take over. It has no team field, so group by title words, and raise `records_limit` for a full month (not measured past 200).
- **Pay band drift:** NVIDIA detail pages carried a pay range in the text on 20 of 20 US Engineering postings ("136,000 USD - 218,500 USD", no "$" sign), and Snowflake's Ashby compensation summary was on 231 of 231 US jobs. Track the median band per team.
- **Seniority mix:** for LinkedIn-only companies, chart `job_seniority_level` over time. A shift toward "Director" postings says something different from a wave of "Entry level".

</details>
