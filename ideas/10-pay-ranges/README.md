# 10. A pay tool built on posted salary ranges

**The app people already build:** an internal comp tool. Roles, levels, salary bands per city, and the offers you made. It works with no public data at all: HR types the bands in once a year.

**What public data adds:** pay transparency laws in several US states mean many job postings now show a base pay range. Pull the postings for the same role and city every month, parse the ranges, and every band and every offer gets a market check: where it sits among 75 to 83 posted ranges from 61 to 74 companies per role and city. Keep each run and you see the market move.

| Without public data | With public data |
|---|---|
| Bands come from last year's survey or a guess | Checked against 75 to 83 posted ranges per role and city |
| "Competitive offer" is an opinion | Each offer shows where it sits among real postings, with links |
| You learn a band is stale when a candidate says no | A monthly run shows the posted ranges moving |

## Why not just ask the AI?

We gave Claude Code its own web search and fetch tools and asked for 10 current software engineer openings in San Francisco, at any company, with the posted base pay range as written in the ad. Measured 2026-10-19:

- **Exact pay: the AI did fine.** 10 of 10 ranges matched the posting, and all 10 were still open.
- **Coverage: 10 rows from only 3 company boards** (Figma, Anthropic, Stripe), all multi-city postings. That is three companies, not the market.
- **A second run** asked for 25 product manager openings in New York: 25 rows from 12 companies, pay confirmed on 23 (the other 2 not confirmed, not proven wrong), and 14 of the 25 were first posted more than 60 days ago.
- **Time:** each run took 5 to 8 minutes (305.2 s and 461.4 s; each run also counted open roles per team at named companies).

So to check what a few named companies post, the AI alone is enough. The scraper wins on breadth (61 to 74 companies per role and city in one job), fresh postings (all from the past month), Indeed (which returns 403 to a plain fetch), and a monthly refresh that runs with nobody waiting.

## Paste this into your agent

Open Claude Code or Cursor in this repo, then:

```
Read AGENTS.md and ideas/10-pay-ranges/README.md first.

Build a pay-band checker in apps/pay-ranges/ (Node 20+, built-in fetch and node:http,
plain HTML/JS, JSON files in apps/pay-ranges/data/, no npm install):
1. Internal data: data/bands.json (role, level, city, min, max) and data/offers.json
   (role, level, city, base, date). Seed 3 Software Engineer levels in San Francisco.
2. collect.mjs <role> <city>: trigger the card's LinkedIn job listings scraper
   (discover_by=keyword, time_range "Past month", limit_per_input=20 while testing),
   poll, download. Also fetch Indeed page 1 through Web Unlocker as markdown and parse
   it with parseIndeed() from examples/intern-intel/js/parsers.mjs: inside this repo,
   import it (do not copy it); in your own project copy parsers.mjs and compat.mjs side
   by side. Never request Indeed start=10.
3. pay.mjs, the range parser from the card's Traps: base_salary first, else job_summary.
   Return EVERY range with its label (level, zone, city), not just the first. Handle
   $ and USD, K, "to", U+2013/U+2014 dashes, hourly (x 2080). Flag OTE and non-USD.
   Unit-test it on the strings quoted in Traps and sample.json before any API call.
4. Save each run to data/runs/<role-slug>-<city-slug>-<fetched_at with ':' replaced
   by '-'>.json, one row per posting: company, title, location, pay_min, pay_max,
   pay_label, pay_source, url, fetched_at. Dedupe LinkedIn against Indeed on company + title.
5. server.mjs: a "Refresh market" button starts collect as a background job and
   returns at once; the page polls job status. Page loads only read data/.
6. Page: per band, postings and companies counted, median posted min and max (level
   matched from the range label or title words like Senior, Staff, II), a flag when
   the band or an offer sits outside them, the change since the last run, and links.
7. refresh.mjs: one LinkedIn job with every role-city in bands.json as inputs (plus Indeed
   page 1 per pair), for a monthly cron.
Keep BRIGHTDATA_API_TOKEN on the server and never print it.
Test with one role in one city: "software engineer" in "San Francisco, California".
```

Already have a comp tool? Copy `AGENTS.md`, this folder, and `examples/intern-intel/js/parsers.mjs` with `compat.mjs` (keep them side by side) into your project, then point step 1 at your own bands table and step 2's import at the copied parsers.mjs.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Postings for one role in one city | Web Scraper API, LinkedIn job listings scraper `gd_lpfll7v5hcqtkxl6l`, trigger with `&type=discover_new&discover_by=keyword&limit_per_input=100`. One input per role-city: `{"keyword": "software engineer", "location": "San Francisco, California", "country": "US", "time_range": "Past month"}`. Batch them into one job. | 4 role-city inputs: 395 records in 263.2 s, 0 errors, 61 to 74 companies per query, posted 2026-09-28 to 2026-10-19. A later test run, one role-city at `limit_per_input=20` plus Indeed page 1: about 92 s per collect, 3 runs, 20 records and 15 Indeed cards each time. |
| 2. Pull the range | `base_salary` (`min_amount`, `max_amount`, `payment_period`) when it is set, else parse `job_summary` (plain text; `job_description_formatted` is the same text as HTML). | `base_salary` set on 72 of 395 (15 to 22 per query, all `yr`). A range in the text on 291 of 395. A range from either: 75/100, 76/100, 75/95, 83/100. |
| 3. Add Indeed page 1 | Web Unlocker, `https://www.indeed.com/jobs?q=<role>&l=<city>` with `"data_format": "markdown"`. Parse with `parseIndeed()` and read `pay`. | 4.2 to 46.8 s. 15 cards per query, pay on 57 of 60. Page 2 failed 4 of 4. |
| 4. Company boards with pay (plain fetch, no Bright Data) | Ashby: `GET https://api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true`, read `compensation.summaryComponents[]`. Workday: `GET .../wday/cxs/<tenant>/<site>/job/<externalPath>`, parse `jobPostingInfo.jobDescription`. | Snowflake: 355 jobs in 0.49 s, pay on 243 (231 of 231 US jobs). NVIDIA: 20 detail calls in 4.3 s, a range on 20 of 20. |

Request shapes are in [AGENTS.md](../../AGENTS.md). The Indeed parser is already in the repo with no dependencies: `parseIndeed()` in [`examples/intern-intel/js/parsers.mjs`](../../examples/intern-intel/js/parsers.mjs), a port of the Python parser we measured with. In this repo, import it from there. Its only import is `compat.mjs` next to it, so in your own project copy both, side by side.

**Fields you get.** LinkedIn job listings: `job_title`, `company_name`, `company_id`, `job_location`, `country_code`, `job_posted_date`, `job_posted_time`, `job_seniority_level`, `job_employment_type`, `job_industries`, `job_num_applicants`, `base_salary`, `job_base_pay_range` (`"$150,000.00/yr - $275,000.00/yr"`), `salary_standards`, `job_summary`, `url`, `discovery_input`. No job function or team field. Indeed, through the parser: `title`, `company`, `location`, `pay` (the text as shown), `pay_hourly_min`, `job_id`, `url`, no posted date. Ashby: `title`, `department`, `team`, `location`, `secondaryLocations`, `publishedAt`, `jobUrl`, and `summaryComponents[]` with `compensationType`, `interval`, `currencyCode`, `minValue`, `maxValue`. Keep rows where `compensationType` is `Salary`; Snowflake also had Bonus, Commission and EquityPercentage rows, and CAD and AUD salaries.

What it looked like for software engineers in San Francisco: the structured LinkedIn ranges ran from $105,000 to $350,000, and Indeed page 1 had 12 of 15 cards with pay, median posted min $150,000 and median posted max $210,000.

## Sample

[`sample.json`](sample.json) has trimmed real records from each source (company postings only), with field names exactly as each source returns them, plus the Indeed page 2 failure. One LinkedIn record that has both the structured range and the text:

```json
{
  "job_title": "Staff Software Engineer, Konnect Core Platform",
  "company_name": "Kong",
  "job_location": "San Francisco, CA",
  "job_posted_time": "2 weeks ago",
  "job_posted_date": "2026-10-05T19:09:14.155Z",
  "job_seniority_level": "Mid-Senior level",
  "base_salary": { "min_amount": 150000, "max_amount": 275000, "currency": "$", "payment_period": "yr" },
  "job_base_pay_range": "$150,000.00/yr - $275,000.00/yr",
  "job_summary": "...Compensation Range: $150K - $275K Show more Show less",
  "timestamp": "2026-10-19T19:09:14.177Z"
}
```

## Traps

The parser is the product. Every string below is quoted from the 2026-10-19 data.

- **The range is usually in the text, not the field.** `base_salary` was set on 72 of 395 postings; a range sat in `job_summary` on 291. Read the field first, then the text, and store `pay_source`. They can disagree: Forage's `base_salary` is 185,000 to 200,000 while its text says "$185k-$220k USD".
- **Same number, many spellings.** "$160,000 - $200,000 a year" (Indeed), "$160K - $230K" (Ashby), "$185k-$220k USD", "$160,000 to $200,000" (Discord), "$124,000.00 - 186,000.00" (Paramount+, no $ on the second number).
- **No dollar sign at all.** NVIDIA writes "136,000 USD - 218,500 USD". A $-only regex found a range on 0 of 100 NVIDIA postings; NVIDIA's own job pages had one on 20 of 20. The 291 above was counted with that $-only regex, so it misses this form.
- **Not every dash is a hyphen.** Roblox, Twitch, Figma and Ashby's `compensationTierSummary` put U+2014 or U+2013 between the numbers. Match `-`, `to`, U+2013 and U+2014.
- **Hourly pay.** 1 of the 15 Indeed cards for software engineer in New York read "$55.50 - $78.00 an hour". Convert at 2080 hours a year (what `payHourlyMin()` in examples/intern-intel/js/parsers.mjs uses) or keep hourly rows apart. Ashby says it in `interval` ("1 YEAR" or "1 HOUR").
- **One posting, several levels.** NVIDIA: "136,000 USD - 218,500 USD for Level 3, and 168,000 USD - 264,500 USD for Level 4". DoorDash lists I4, I5 and I6 ranges in one posting. A first-match parser keeps the lowest level only. For a levels tool these labeled ranges are the best data you get: keep each one with its label.
- **One posting, several cities or zones.** Twitch lists Seattle ($143,700 to $194,400) before San Francisco ($165,200 to $223,600), so first-match gives an SF posting the Seattle range. Affirm splits "(CA, WA, NY, NJ, CT)" from "all other U.S. states"; Atlassian, Snap and Unity use Zone A, B and C. Pick the range whose label matches the city.
- **Multi-city postings double-count.** Stripe posts one range ($190,400 to $285,600) for "San Francisco, New York City, Seattle, Chicago, US-Remote"; Figma, Anthropic and Duolingo do the same. Count a posting once per run, not once per city query.
- **The same job is on LinkedIn and Indeed.** Discord's "Software Engineer, Notifications" shows $160,000 to $200,000 on both. Dedupe on company + title before you take a median. At `limit_per_input=20` no posting was on both in 3 runs, so test the dedupe on the Discord pair, not on live data.
- **Base is not OTE.** Verkada's range is on-target earnings (base plus commissions). Stripe's postings carry a stock sentence about OTE "for sales roles", even on a product manager posting, so flag a range labeled OTE but do not drop a posting on the word alone.
- **Not every dollar amount is pay.** Robinhood's description opens with "$124 trillion of assets". The measurement only counted a range when the low end was at least 30,000.
- **LinkedIn dates and levels are coarse.** `job_posted_date` is the scrape time minus `job_posted_time` ("2 weeks ago" is exactly 14 days earlier). `job_seniority_level` was "Mid-Senior level" on 81 to 92 postings per query, so map levels from the title or the labeled ranges.
- **What blocks without Bright Data.** Indeed: 403 "Security Check" on 3 of 3 plain fetches. LinkedIn guest pages, plain: a pay box on 7 of 40 job pages, pay on 0 of 80 search cards, and 429 on 17 of 65 requests.
- **What does not, so skip Bright Data there.** Ashby (0.49 s), NVIDIA's Workday job details (20 of 20) and stripe.com job pages (16 of 16 with pay) all answered a plain fetch. But Greenhouse's API often has no pay: Stripe had a range in `content` on 2 of 65 query matches for software engineer and product manager in SF and NY (a multi-city posting counts once per city), and `pay_input_ranges` was empty on 37 of 37 distinct postings. Use `stripe.com/jobs/search?gh_jid=<id>` for Stripe.
- **Indeed stops at page 1.** `start=10` returned an empty 200 with `x-brd-error-code: reject_authwall` on 4 of 4. That is the logged-out ceiling. Do not go past it.
- **Scraper jobs take minutes.** 263.2 s for 4 role-city queries. Precompute every role-city on a schedule and never fetch on a click.

## Make it yours

- **Offer check before it goes out:** when someone enters an offer, show where it sits among the same role and city postings, with links, on the approval screen.
- **Borrow other ladders:** collect the labeled ranges (NVIDIA Level 3 and 4, DoorDash I4 to I6) and line them up against your own levels.
- **Watch the companies you hire against:** add their Ashby boards (plain fetch) and alert when their range for a role changes between runs.
- **Add cities:** run the same role in more cities and show the spread. On Indeed page 1 the median posted min for software engineers was $150,000 in San Francisco and $140,000 in New York.
