# 09. Public business research for a loan application

Add a panel of public business information to each loan application: Yelp ratings
and review counts, opening hours, job listings and LinkedIn company details. Save
weekly results so an underwriter can see what changed and check the source.

The prompt creates `apps/loan-desk/`. It supports a human review; it does not score applicants or approve or reject loans.

## Paste this into your agent

Finish [setup](../../SETUP.md), then open this project in Claude Code or Cursor.
Expand the prompt below and paste the whole block into your agent. It will build
the app and test it with a small real input using your Bright Data account.

<details>
<summary>Copy the build prompt</summary>

```
Read AGENTS.md and ideas/09-small-business-lender/README.md first.

Build a small loan desk in apps/loan-desk/ (Node 20+, node:http, plain HTML/JS, no npm install,
JSON files in apps/loan-desk/data/, and add that folder to .gitignore):
1. A form: business name, amount, purpose, and three optional fields: Yelp URL, LinkedIn company
   URL, job board ("greenhouse:<org>" or "ashby:<org>"). Each application page has a checklist
   the underwriter ticks (documents in, ID checked, cash flow reviewed).
2. A "Collect footprint" button starts a job on the server and returns right away. The page
   shows "collecting..." and polls. Never call Bright Data on a page load.
3. The job, per application, skipping any source it does not have: the Yelp biz page through
   Web Unlocker (format raw), parsed as in the card's route; the job board with plain fetch;
   the LinkedIn company scraper gd_l1vikfnt1wgvvqz95w.
4. Append each run to data/runs.json with application_id, fetched_at and the source URLs.
   Never overwrite an old run.
5. A "Public footprint" panel: latest values, change since the previous run (review count delta,
   rating change, open roles, employees_in_linkedin, followers), and "reviews on Yelp since at
   least <year>". Title it "Signals for the underwriter, not a decision". No score, no auto-decline.
6. apps/loan-desk/refresh.mjs re-runs the job for every open application, for a weekly cron.
7. Keep the key server-side and never print it. Store no owner, reviewer, photo-author or
   post-author names; for LinkedIn updates keep date and likes_count, not text.
Test with two applications: Bansho Ramen (https://www.yelp.com/biz/bansho-ramen-berkeley-3) and
Stripe (https://www.linkedin.com/company/stripe, greenhouse:stripe). One run makes 2 Bright Data
scrape calls (one Web Unlocker page, one LinkedIn scraper job), plus any retries. Run
refresh.mjs twice and check that each application shows two runs.
```

</details>

## Make it yours

- Keep watching the business after funding.
- Compare a business with nearby competitors.
- Let the underwriter add a note beside each source.

<details>
<summary>Build reference: API requests, sample data and test results</summary>

The rest of this card is for your coding agent and anyone changing how the app
collects data. Keep these instructions with the prompt.

### Adding this to an existing app

Building your own app instead? Copy `AGENTS.md`, this folder and `ideas/08-restaurant-dashboard/yelp_competitors.mjs` (its `parseBiz` and `unlockerPage` exports) into your project, or write the parser from step 1 of the route yourself. Then point step 3 at your code.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Yelp page (applicants with a storefront) | Web Unlocker, url `https://www.yelp.com/biz/<slug>`, `format: "raw"`, not markdown. Parse the `data-apollo-state` script, key `Business:<encid>`. Ask for the Yelp URL on the form. | 6 of 6 pages OK in 13.4 to 39.8 s, 1.5 to 1.85 MB each. Bansho: 27.5 s. |
| 2. Review history, as a lower bound | Same page, no extra call: the `application/ld+json` `ItemList` of `ImageObject`. Read `review.datePublished` and `review.reviewRating.ratingValue`. | 40 entries, 28 unique dated ratings for Bansho once local-time and UTC copies are merged (34 if you drop only exact duplicates), 2019-03-27 to 2026-04-15. Reviews with photos only. |
| 3. Open roles (if they have a public board) | Plain fetch, no Bright Data: `https://boards-api.greenhouse.io/v1/boards/<org>/jobs?content=true` (plus `/departments`), or `https://api.ashbyhq.com/posting-api/job-board/<org>` | Stripe (Greenhouse): 723 jobs in 2 calls, 0.73 s + 0.28 s. Snowflake (Ashby): 355 jobs in 0.49 s. |
| 4. LinkedIn company (bigger applicants) | Web Scraper API, LinkedIn company information scraper, `gd_l1vikfnt1wgvvqz95w`, input `{"url": "https://www.linkedin.com/company/<slug>"}`. Put all applicants in one batch job. | 4.5 to 23.9 s for one. 10 took 56.5 s; 35 took 34.9 s async. |
| 5. Store and compare | Append every run with `fetched_at`. Review velocity = this week's `reviewCount` minus last week's. | One day measured. Week-to-week change was not measured. |

Request shapes are in [AGENTS.md](../../AGENTS.md). [`ideas/08-restaurant-dashboard/yelp_competitors.mjs`](../08-restaurant-dashboard/yelp_competitors.mjs) fetches and parses the same Yelp biz page; reuse its parser for step 1.

**Fields you get.** Yelp `Business:<encid>`: `alias`, `encid`, `name`, `rating`, `reviewCount` (exact), `priceRange.display`, `categories`, `isClosed`, `closedUntil`, `claimability({"useConsumerClaimability":true}).isClaimed`, `isYelpAdvertiser`, `history.yearEstablished`, `operationHours.regularHoursMergedWithSpecialHoursForCurrentWeek[]` (`dayOfWeekShort`, `hours`) and `operationHours.regularHoursLastUpdated`; the address is in `BusinessLocation:<encid>`. Greenhouse `jobs[]`: `title`, `departments[]` (with `parent_id`), `location.name`, `first_published`, `updated_at`, `absolute_url`. Ashby `jobs[]`: `title`, `department`, `team`, `location`, `publishedAt`. LinkedIn: `employees_in_linkedin`, `followers`, `company_size`, `founded`, `organization_type`, `locations`, `updates[]` (`date`, `likes_count`, `text`), `timestamp`.

How complete: on 48 LinkedIn company records, `employees_in_linkedin`, `followers`, `company_size` and `organization_type` were present 48 of 48, `locations` 47, `updates` 44, `founded` 37. On Yelp, Bansho's `history.yearEstablished` was null.

## Sample

[`sample.json`](sample.json) has trimmed real records (businesses only) from the Yelp page, the Yelp reviews scraper, two job boards and one LinkedIn company, with field names exactly as each source returns them. The Yelp business, from the Apollo state:

```json
{
  "alias": "bansho-ramen-berkeley-3",
  "encid": "EkfGAqi1XZdMe2gMlrD4Kw",
  "name": "Bansho Ramen",
  "rating": 4.1,
  "reviewCount": 196,
  "priceRange": { "display": "$$" },
  "isClosed": false,
  "claimability({\"useConsumerClaimability\":true})": { "isClaimable": false, "reason": "ALREADY_CLAIMED", "isClaimed": true },
  "history": { "description": null, "yearEstablished": null },
  "operationHours": {
    "regularHoursMergedWithSpecialHoursForCurrentWeek": [ { "dayOfWeekShort": "Tue", "hours": ["11:30 AM - 9:00 PM"] } ],
    "regularHoursLastUpdated": "Updated over 3 months ago"
  }
}
```

## Traps

- **Yelp blocks plain fetches.** Python requests got HTTP 403 from DataDome on 11 of 11 search and biz URLs, and Claude's WebFetch got 403 on 8 of 8. Go straight to Web Unlocker for Yelp.
- **Use raw HTML, not markdown.** Markdown rounds review counts ("2.3k"). The exact `reviewCount` is in `data-apollo-state`.
- **There is no review list to average.** The biz HTML holds 0 reviews, `?sort_by=date_asc` returns the same content, the old `/biz/<encid>/review_feed` returns a "Page not found" page inside a 200, and `/biz/<slug>/props` has no reviews (105 s). That is why "average of the last 20 reviews" and "exact first review date" are not in this card.
- **JSON-LD dates are photo dates.** They come only from reviews with photos (28 unique for a business with 196 reviews, mean 3.86 against 4.1 overall), and the same review can appear twice in two formats, 7 hours apart (`2025-03-10T07:15:57` and `2025-03-10T14:15:57Z`). Treat a timestamp without Z as the business's local time (America/Los_Angeles for Bansho) and convert it to UTC before deduping (gives 28). Or merge entries with the same minutes:seconds and rating (also 28). The hour, and sometimes the date, shifts with the time zone; exact-string dedupe leaves 34. Use the earliest only as "since at least <year>".
- **The Yelp scrapers are not the route.** The Yelp businesses reviews scraper (`gd_lgzhlu9323u3k24jkv`) returned 0 records on run 1, then 10 of Bansho's 196 reviews and 0 for the other input in 408.8 s. All 10 were not-recommended reviews (mean 3.3), and older dates land on Oct 19 to 21 of each year, so they are year-precision only. The Yelp businesses overview scraper (`gd_lgugwl0519h1p14rwk`) returned nothing usable for 3 inputs (196 to 377 s, `detect_block`).
- **Read the right claim flag.** `claimability` alone only has `isClaimable` (false for Bansho, because it is already claimed). The answer is in `claimability({"useConsumerClaimability":true}).isClaimed`.
- **Zero reviews is a signal, not an error.** A new listing shows rating null and review count 0 (Tora Ramen).
- **Week-to-week stability was not measured.** A Yelp search rerun 5.5 minutes later matched exactly, and no slug mapped to two ids across 69 slugs. Store `encid` with every run so the series survives a slug change.
- **LinkedIn funding fields are empty.** `funding`, `crunchbase_url`, `investors` and `stock_info` were empty on 48 of 48 live records. Funding needs another source (not measured here).
- **`additional_information` "open jobs" is not the company's openings.** It is a LinkedIn-wide keyword total ("Engineer (555,845 open jobs)"). Use the company's job board.
- **`employees_in_linkedin` is a signal, not a headcount.** It often sits outside the listed size band (Bubble 503 and Momenti 6 in 51-200 employees). Watch how it moves between runs.
- **LinkedIn plain fetch works, then throttles.** Logged-out plain fetches of one company page returned 200 on 10 of 10 (two bursts of 5, an hour apart). A sweep of 30 pages through one reused HTTP client, 1.5 s apart, got HTTP 999 on 26. For a weekly sweep of every applicant, use the scraper.
- **Job board dates only cover open postings.** `first_published` exists only for jobs still open, so diff stored runs to see what closed. Some boards block plain fetches (Tesla: 403; Web Unlocker got it in 29.15 s, with no dates).
- **People are in this data. Leave them out.** The biz page carries the owner's display name (`bizOwnerProfile`) and JSON-LD photo authors, the reviews scraper returns reviewer names and text, and LinkedIn `updates[].title` is whoever posted, sometimes a person, while `updates[].text` can name people. Store none of it. A raw-page cache holds `bizOwnerProfile` too: keep `cache/` gitignored and delete it once the parser works, or strip `bizOwnerProfile` before caching.

## Why not just ask the AI?

We asked Claude Code the questions this app asks, with only its built-in web search and fetch tools (no Bright Data). Measured 2026-10-19:

- **One named business: it got the headline numbers.** For Bansho Ramen we asked for the Yelp rating, exact review count, first review date, and the 20 latest reviews with their average. Rating 4.1 and count 196 were right, in 34.6 s, even though all 4 of its Yelp fetches got HTTP 403. It had no review dates (2 of 5 fields). We could not get those 3 fields either, so this card does not promise them.
- **A list of businesses (card 08's question): names, not numbers.** Asked for rating, review count and price for every ramen place within a mile, it found 7 real ones and returned 0 of their 21 rating, count and price values.
- **LinkedIn companies: the AI did fine.** 30 of 30 fields exact for 5 well-known companies.
- **Open job boards: right.** Stripe's 723 open jobs and 208 of 208 department counts exact (card 04's test). A board that blocks plain fetches (Tesla, 403) came back null.

So one lookup on one business is something the AI can do. The app's value is the series: the same fields for every applicant, stored every week with nobody asking, read from Yelp pages that return 403 to plain fetches.

### More build ideas

- **Portfolio watch:** keep the weekly job running after funding and flag a closed flag, a review count that stops growing, a rating drop, or a job board that empties.
- **No public job board:** the LinkedIn job listings scraper (`gd_lpfll7v5hcqtkxl6l`, `discover_by=url`) takes `https://www.linkedin.com/jobs/search?keywords=&f_C=<company_id>&geoId=92000000&f_TPR=r2592000` and returned 200 postings for two companies in 167.6 s, each with `job_posted_date` and `job_num_applicants`.
- **Neighborhood context:** card 08 finds the competitors within a mile of an address. Show the applicant's rating trend next to theirs.
- **Underwriter notes:** let the underwriter mark each signal "checked" with a note, kept next to its source URL and `fetched_at`.

</details>
