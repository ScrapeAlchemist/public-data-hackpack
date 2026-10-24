# AGENTS.md

Notes for the coding agent (Claude Code, Cursor, Codex) working in this repo, or in a project that copied an idea card from it. Read this file first, then the card for the idea you are building.

A copied card also needs the code it uses from elsewhere in this repo: card 03 imports `ideas/01-crm-autofill/enrich.mjs`, card 09 reuses the parser in `ideas/08-restaurant-dashboard/yelp_competitors.mjs` (or write the parser from step 1 of its route), and card 10 imports `examples/intern-intel/js/parsers.mjs`, which needs `compat.mjs` next to it. Copy those files too.

## What this repo is

A hackpack of ideas. Each folder in `ideas/` is an app people already build, plus the public web data that makes it much better. Every card has:

- **The route**: the exact requests that returned the data when we measured it (2026-10-19), with timings.
- **A sample**: `sample.json`, trimmed real records from that run. Build your parser against it.
- **Traps**: what broke and how to get around it.

Follow the card's route. The plain-looking alternatives (fetch the page, call the `.json` endpoint, use a different search engine) were tried and are listed in the traps because they failed. Only look for another source if the card's route fails for you, and say so to the human when you do.

`crm/` is a small starter CRM (Node 20+, no npm install) used by card 01 and the workshop. Start it with `node crm/server.mjs`, then open http://localhost:3000. On first start it copies the demo contacts from `crm/data/seed.json` (tracked) to `crm/data/contacts.json` (gitignored), and every change goes to `contacts.json`. Never write contacts or enriched profile data to `seed.json`. `examples/intern-intel/` is a finished example app with its own README.

`radar/` is the workshop demo: an AI radar for Reddit, X and GitHub, measured 2026-10-22. Run `node radar/radar.mjs` (prints and saves a run) or `node radar/server.mjs` (the page, http://localhost:3001). What it watches is in `radar/radar.config.json`; every run is saved to `radar/data/runs/` (gitignored). When you extend it, reuse the exports of `radar/radar.mjs` (`runRadar`, `fetchReddit`, `fetchX`, `fetchGitHub`, `loadConfig`, `listRuns`, `lastGood`) instead of rewriting the routes, and read `radar/README.md` for its traps. A new source goes into `SOURCES` and the `jobs` map in `runRadar`, plus a column in `radar/public/index.html`; `server.mjs` needs no change, it reads `SOURCES` from `radar.mjs` (radar/README.md, Make it yours).

## Bright Data agent skills

Bright Data's agent skills (https://github.com/brightdata/skills) have everything you need to use Bright Data's tools: the MCP server, the CLI, Web Unlocker, the SERP API, the Web Scraper API, the Browser API, proxies, and the Python and JavaScript SDKs. If they are installed, use them for anything this file and the card do not cover. If they are not, tell the human they can add them with `npx skills add brightdata/skills` (SETUP.md step 4).

Skip any skill step that calls Bright Data's Discover API (`/discover`, `bdata discover`, `client.discover`): it is gone (it returned 404 on 2026-10-23). The `discover-api`, `live-research` and `rag-pipeline` skills are built on it, and `search`, `agent-onboarding` and the Python and JavaScript SDK skills have Discover steps. Use the routes in this file and the cards instead.

## Secrets

- The Bright Data API key comes from the env var `BRIGHTDATA_API_TOKEN` (accept `BRIGHTDATA_API_KEY` as a fallback), loaded from a `.env` file. If it is missing, stop and ask the human to add it. See `SETUP.md`.
- Never print, log, or commit the key. Never put it in front-end code or in a URL. Every Bright Data call runs on the server side of the app.
- `.env` is in `.gitignore`. Keep it there.

## Zones

Web Unlocker and Google requests need a zone name. One Web Unlocker zone covers both.

1. If `BRIGHTDATA_ZONE` is set and not empty, use it.
2. Otherwise call `GET https://api.brightdata.com/zone/get_active_zones` (same auth header). It returns `[{"name": ..., "type": ...}]`. Use a zone with type `unblocker`. Connecting the hosted Bright Data MCP may also create one named `mcp_unlocker` (not yet tested on a new account).
3. If the account has no `unblocker` zone, stop and ask the human to add a Web Unlocker zone in the Bright Data control panel. Do not create zones yourself.

A zone with type `serp` also works for Google requests. On 2026-10-19 the same Google query returned the same JSON (10 organic results) through an `unblocker` zone in 9.2 s and a `serp` zone in 10.7 s. That comparison was a plain Google search. Card 05's Google Shopping step (`udm=28`) was measured with a `serp` zone only; it was not tested through an `unblocker` zone.

The Web Scraper API and the Filter Dataset API need no zone.

## The four calls

All calls go to `https://api.brightdata.com` with the header `Authorization: Bearer <key>`.

### 1. Web Unlocker: any public page

```
POST /request
{"zone": "<unblocker zone>", "url": "<page url>", "format": "raw", "country": "us"}
```

Returns the page body (HTML). Add `"data_format": "markdown"` to get markdown instead, but check the card first: on several sites markdown drops exact numbers (Yelp review counts become `2.3k`, Reddit loses votes and timestamps).

- A 200 with an empty or tiny body means it failed. Read the `x-brd-error` and `x-brd-error-code` response headers (`reject_element`, `bucket_rate_limit`, `http_status`, ...), wait a few seconds and retry, up to 3 attempts in all. Tesla's board once took 3: a 429 from the site, then a certificate error, then the full page.
- Retry the same way on a 5xx. If every attempt fails, store the error and move on; do not record it as zero.
- Measured latency: 2 to 40 s per page, sometimes more. Never fetch on a user click and make them wait; queue it and show progress.

### 2. Google results as JSON

```
POST /request
{"zone": "<unblocker zone>", "url": "https://www.google.com/search?q=<url-encoded query>&hl=en&gl=us&brd_json=1", "format": "raw", "country": "us"}
```

Returns JSON. Results are in `organic[]`, each with `link`, `title`, `description`, `display_link`, `rank`. Measured 2 to 20 s.

- Sometimes it fails quietly: on 2026-10-19, 2 of 12 calls returned a 200 with an empty body and `x-brd-error-code: captcha`. Retry up to 3 times with a short wait.
- In a later test 3 of 6 parallel calls came back that way, and once a 200 carried a text message instead of JSON. Treat any body that does not parse as JSON as a failed call.
- Now and then Google ignores `site:` and returns generic results. Check the links match what you asked for, and ask again if not.
- Have a second route for anything a user waits on. For LinkedIn profiles, `ideas/01-crm-autofill/enrich.mjs` falls back to the people search scraper when Google keeps failing.

### 3. Web Scraper API: structured records from a site

Each site has its own scraper, named by a `dataset_id` (the card gives it). Inputs are usually URLs.

Sync, for a few inputs:

```
POST /datasets/v3/scrape?dataset_id=<id>&format=json&include_errors=true
{"input": [{"url": "<url>"}, ...]}
```

- A 200 returns the records (a JSON array).
- If the job runs longer than about a minute, it returns 202 with `{"snapshot_id": "..."}` instead. Then poll as in async.

Async, for batches or discovery:

```
POST /datasets/v3/trigger?dataset_id=<id>&format=json&include_errors=true
{"input": [ ... ]}
```

- Returns `{"snapshot_id": "..."}`.
- For discovery (find records by keyword, user name, and so on) add `&type=discover_new&discover_by=<method>` and the inputs the card shows.
- Poll `GET /datasets/v3/progress/<snapshot_id>` every 5 to 10 s until `status` is `ready` (or `failed`).
- Download with `GET /datasets/v3/snapshot/<snapshot_id>?format=json`. Retry the download if it is not ready yet.

In both cases, check every record. A record with an `error` or `error_code` field (for example `dead_page`) can sit inside a 200 response.

Measured: 4 s to about 4.5 min on the routes in the cards; scrapers the cards list as traps took up to 789 s (13 min). Batch inputs into one job instead of one job per item.

### 4. Filter Dataset: many records at once from a pre-collected dataset

For "give me every company that matches X" (card 02; also card 04's backfill and card 03's sourcing idea).

```
POST /datasets/filter
{"dataset_id": "<id>", "records_limit": 1000,
 "filter": {"operator": "and", "filters": [
   {"name": "<field>", "operator": "=", "value": "<value>"},
   {"name": "<field>", "operator": "includes", "value": "<text>"}
 ]}}
```

- Returns `{"snapshot_id": "..."}`.
- Poll `GET /datasets/snapshots/<snapshot_id>` until `status` is `ready` (it says `building` until then).
- Download with `GET /datasets/snapshots/<snapshot_id>/download?format=json`.
- At most 4 rules in one logical group; nest an `{"operator": "or", "filters": [...]}` group for more.
- It takes about 1 to 18 minutes (measured: 50 companies in 54.9 s, 200 job listings in 116 to 119 s, 987 companies in 292.6 s, a people filter in 947.7 s on 10 companies and 1074.2 s on 956). Build it ahead of time and store the result. Never make a user click wait on it: start it as a background job and serve the stored result.
- Records have no timestamp. Re-scrape anything you show as current.

## Plain fetch first, when the card says so

Some sources are open and need no Bright Data at all: public ATS job APIs (Greenhouse, Ashby, Workday), YouTube search pages and RSS feeds, and Amazon or Walmart product pages at small volume. The cards say which. Use plain `fetch` for those and keep Bright Data for what blocks.

## How to build with this data

- **Store snapshots with a timestamp.** Most of the value is in change over time (price dropped, mentions doubled, a team doubled its open roles). One fetch is a level, not a trend, so write every result to storage with `fetched_at` and compare runs.
- **Run collection as a job, not a request.** A button starts a job; the UI shows progress and reads results from storage. A scheduled job (cron, a loop, a GitHub Action) keeps data current.
- **Cache while you develop.** Save raw responses to a `cache/` folder (gitignored) and re-read them, so you do not refetch the same page while iterating on the parser.
- **Show where each value came from.** Keep the source URL and `fetched_at` next to the value.
- **Listen on 127.0.0.1 only.** The apps you build have no auth, and their buttons start Bright Data calls on the human's key. Bind the server to `127.0.0.1` (in Node, `server.listen(port, '127.0.0.1')`) so nobody else on the hackathon Wi-Fi can reach it. `http://localhost:<port>` still works in the browser.

## One rule

Public, logged-out data only. Never log in, never use cookies from a session, never get past a paywall.

## Exploring with the MCP server

If the Bright Data MCP server is connected, you can use it to explore (`search_scrapers`, `get_scraper_details`, `run_scraper`, `search_engine`, `scrape_as_markdown`). The app itself calls the REST API above, so it runs without the agent.
