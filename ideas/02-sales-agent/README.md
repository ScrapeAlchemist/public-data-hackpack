# 02. A sales agent that builds its own lead list

**The app people already build:** an outreach agent. Upload a CSV of leads and it drafts a personalized first email for each one. It works with no public data at all: you bring the list.

**What public data adds:** describe your ideal customer in words ("software companies in New York with 51-200 people") and the agent builds the list itself from LinkedIn's company dataset: 987 companies for that sentence. Then it finds the right people there by title (554 VP, Head of, Director and Chief titles at 319 of those companies) and drafts. It never sends anything. Drafts only.

| Without public data | With public data |
|---|---|
| You buy, scrape or hand-type the lead list | 987 matching companies from one filter request |
| You guess who to write to | 554 senior titles at 319 of those companies |
| "I came across your company..." | Drafts that use size, HQ, founding year, specialties and the latest company post |
| The list is stale the day you export it | Re-scrape the shortlist live: 35 companies in 34.9 s |

## Why not just ask the AI?

We gave Claude Code its own web search and fetch tools and the same customer profile (LinkedIn industry "Software Development", "51-200 employees", HQ in New York), and asked for up to 40 matching companies. Measured 2026-10-19:

- **Accuracy: the AI did fine.** It returned 35 companies. We re-scraped all 35: every one is a real match, and 175 of 175 fields were exact.
- **Volume: 35 vs 987.** The AI took 314.6 s and 112 tool calls (100 LinkedIn page fetches, 12 searches). The filter returned 987 in 292.6 s. The AI itself estimated about 2,000 such companies exist.
- **Overlap:** 32 of the AI's 35 are also in the 987. One of the other 3 has HQ "Brooklyn, NY" (see Traps).
- **People by title:** we did not ask the AI for this step, so there is no AI number. The filter returned 554 people at 319 companies in one request.

So for a few dozen companies, the AI's own tools are enough and accurate. The dataset wins on volume, on finding people by title across hundreds of companies at once, and on running as a background job nobody waits on.

## Paste this into your agent

Open Claude Code or Cursor in this repo, then:

```
Read AGENTS.md and ideas/02-sales-agent/README.md first.

Build an outreach drafting app in apps/sales-agent/ (Node 20+, no npm install: node:http,
plain HTML/JS, JSON files in apps/sales-agent/data/, and add that folder to .gitignore):
1. CSV upload (company, title, notes) that drafts one first email per row. No BD calls.
2. An ICP form: industry, size band, HQ text, optional fallback role (step 5). "Build
   list" starts a background job that runs the step 1 company filter from the card and
   returns at once. The page polls and shows "building, N s" until the snapshot is ready.
   It takes minutes.
3. "Find people" starts a second job: the step 3 people filter on the 10 companies with
   the most employees_in_linkedin. Keep only linkedin.com/company/<slug> urls and match
   those slugs against current_company_company_id, with one OR group of exactly 4 rules:
   position includes VP, Head of, Director, Chief. Zero people for some companies is normal.
4. Save every run to data/runs/<id>.json with fetched_at, the filter body and the records,
   trimmed to the fields you use (people: position, company slug and country only; no
   names or profile urls). Show people as counts and titles only. Never store emails or
   phone numbers.
5. "Draft" writes one first email per company + title from industries, company_size,
   headquarters, founded and specialties, with a {first_name} placeholder. Use an LLM
   via fetch if LLM_API_KEY is set in .env (say which provider the code expects), else a
   template. For a company with no title hit, do not invent a role: mark it "no contact
   found" or draft to a role the user picks in the ICP form, labeled as chosen by the
   user. Drafts only: no send button, no SMTP.
6. apps/sales-agent/refresh.mjs re-scrapes the saved shortlist with the company scraper
   (step 4), matches records back on input.url, and saves a new run, so a scheduler can
   run it nightly.
7. While the first filter builds, build the UI against ideas/02-sales-agent/sample.json.
Test with industries = "Software Development", company_size = "51-200 employees",
headquarters includes "New York", records_limit 50. Keep the key server-side; never print it.
```

Building into your own outreach tool instead? Copy `AGENTS.md` and this folder into your project and point step 5 at your drafting code.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Build the company list | Filter Dataset on LinkedIn company information, `gd_l1vikfnt1wgvvqz95w`: `industries` = `Software Development`, `company_size` = `51-200 employees`, `headquarters` includes `New York`, `records_limit` 1000 | 987 records. POST answered in 0.44 s, ready at 292.6 s, downloaded at 301.1 s (about 27 MB of JSON). With `records_limit` 50, a later test run had 50 records in 54.9 s. |
| 2. Get the join keys | Take the slug from each `url` (`linkedin.com/company/<slug>`). Keep only `/company/` urls (skip `/showcase/` and `/school/`). | 987 records gave 956 slugs (28 showcase and 2 school pages, 1 duplicate). |
| 3. Find people by title | Filter Dataset on LinkedIn people profiles, `gd_l1viktl72bvl7bjuj0`: `current_company_company_id` in the slugs, AND one OR group of `position` includes `VP`, `Head of`, `Director`, `Chief` (body below) | 554 people at 319 of 956 companies, median 1 per company. Ready at 1074.2 s, downloaded at 1079.2 s. A later run on only 10 slugs: 13 people at 7 of the 10, ready at 947.7 s. A shorter slug list does not make it faster. |
| 4. Refresh the shortlist | Web Scraper API trigger on the company scraper (same id, `gd_l1vikfnt1wgvvqz95w`), input `{"url": "https://www.linkedin.com/company/<slug>"}` | 35 companies in 34.94 s, each record with a `timestamp`. 10 companies: 8.7 to 37.8 s over 4 runs. |
| 5. Draft | Your LLM or a template over the stored fields. No Bright Data call. | Not measured. |

The step 3 body, with the slug list cut to three:

```json
{"dataset_id": "gd_l1viktl72bvl7bjuj0", "records_limit": 1000,
 "filter": {"operator": "and", "filters": [
   {"name": "current_company_company_id", "operator": "in", "value": ["vic.ai", "pinecone-io", "aidotio"]},
   {"operator": "or", "filters": [
     {"name": "position", "operator": "includes", "value": "VP"},
     {"name": "position", "operator": "includes", "value": "Head of"},
     {"name": "position", "operator": "includes", "value": "Director"},
     {"name": "position", "operator": "includes", "value": "Chief"}]}]}}
```

Polling, download and the scraper trigger are in [AGENTS.md](../../AGENTS.md). Both filters take minutes, so run them as a job and serve the stored result.

**Fields you get.** Company (36 fields): `name`, `url`, `industries`, `company_size`, `employees_in_linkedin`, `headquarters`, `website`, `followers`, `founded`, `specialties`, `about`, `organization_type`, `locations`, `updates` (recent posts). People (42 fields): `position`, `current_company`, `current_company_company_id`, `current_company_name`, `city`, `country_code`, `experience`, `education`, `followers`, plus `name` and `url`. Neither filter result has a `timestamp`.

How complete: of 987 companies, `industries`, `company_size`, `employees_in_linkedin` and `headquarters` were present 987 times, `followers` 969, `about` 913, `website` 904, `founded` 748, `specialties` 653, `updates` 615. Of 554 people, `position`, `current_company` and `city` 554, `experience` 553, `followers` 529, `education` 407, `about` 311.

**Exploring from your agent.** The hosted Bright Data MCP has `list_dataset_fields`, which lists the same 42 people and 36 company fields (about 0.4 s per call), and `search_dataset`, which queries these datasets. We did not run `search_dataset`, so its speed and result size are not measured. Both tools are on by default (see the last trap).

## Sample

[`sample.json`](sample.json) has trimmed real company records from the filter and from a live refresh, one showcase record, the HTTP 400 body, and the people step as its request, counts, title hits and field names. No person records, on purpose. One company from the filter:

```json
{
  "name": "Vic.ai",
  "url": "https://www.linkedin.com/company/vic.ai",
  "website": "https://www.vic.ai/",
  "industries": "Software Development",
  "company_size": "51-200 employees",
  "employees_in_linkedin": 93,
  "headquarters": "New York, NY",
  "followers": 14788,
  "founded": 2017,
  "specialties": "artificial intelligence, accounting automation, accounting firms, ..."
}
```

## Traps

- **Never make a click wait on a filter.** Companies took 292.6 s and people 1074.2 s, so about 5 to 18 minutes, and the people filter on just 10 companies still took 947.7 s. Pre-build the snapshot, store it, serve from storage, and show "building" with elapsed time while it runs.
- **Join on the slug, not the name.** Joining on `current_company_name` (150 exact names, 4 exact titles like "VP of Sales") returned 5 people at 5 companies. Joining on `current_company_company_id` (956 slugs, 4 broad words) returned 554. That run also changed the titles, so the slug is not the only reason, but it is the key to use.
- **`company_id` is not the slug.** On live company records it is a number (Pinecone: `"20299330"`) and the slug is in `id` (`pinecone-io`). People carry the slug in `current_company_company_id`. We took it from the company `url`.
- **At most 4 rules per logical group.** One OR group of 8 exact titles returned HTTP 400: `Filter logical groups can have a maximum of 4 rules.` Four broad words fit in one group.
- **Titles need a second look.** Counted once each, in the order VP, Head of, Director, Chief: VP 77, Head of 75, Director 336, Chief 57. 9 of the 554 positions held none of the four strings in the same case. Re-check `position` in code before you draft, and expect mostly Directors. `position` is the profile headline, not a clean title (one was a job title followed by two more labels, split by ` | `), so cut it at ` | `. In the 10-company run, 3 of 13 named a different company in the headline (a Senior Director title naming another employer, listed under accessiBe), because the dataset lags job changes. Skip or flag those.
- **HQ is unstructured text.** 987 records hold 127 different `headquarters` strings: "New York, NY" 358, "New York, New York" 231, "New York" 135, "New York City, New York" 32, "Brooklyn, New York" 30, and so on. `includes New York` also returns Buffalo, Rochester and Albany (20 records) and cannot match "Brooklyn, NY" (one of the AI's companies has that HQ and is not in the 987). Normalize HQ before you count or show it.
- **Showcase and school pages ride along.** 30 of the 987 are `linkedin.com/showcase/...` (28) or `linkedin.com/school/...` (2) pages, not company pages. They have no company slug, so drop them from the people join.
- **No timestamp, and values lag.** 0 of 987 companies and 0 of 554 people have a `timestamp`. Against a live scrape of the 32 overlap companies: size and HQ matched 32 of 32, followers were within 0.5% on 23 and within 5% on 31, one was 8.8% off. Re-scrape the shortlist (step 4) before you show a number as current.
- **Companies rename.** Re-scraping `linkedin.com/company/totango` returned "Odie (formerly Totango)" at `/company/hey-odie-ai`. Every scraper record carries the `input` you sent, so match refreshed records to your list on `input.url`, not on the returned `url`.
- **`employees_in_linkedin` is a signal, not a headcount.** Bubble showed 503 and Momenti 6, both listed as 51-200.
- **The download is big.** 987 companies came to about 27 MB of JSON, 554 people about 10 MB. Keep the fields you use and drop the rest before you store.
- **Plain fetch: fine for a few pages, no use for a list.** Fresh logged-out GETs (5 of one profile page, 5 of one company page, new connection each time) returned 200 on 10 of 10. One script that reused one connection over 30 profile and company pages got HTTP 999 on 26, starting at the 2nd request. And no public page lists every company that matches a profile: that is the filter's job.
- **`&groups=scrapers` hides the dataset tools.** On the hosted MCP it leaves 9 tools, without `search_dataset` or `list_dataset_fields`. Leave it off if you want to explore.

## Make it yours

- **Openers from the news:** a live refresh returns `updates[]`, the company's recent posts with dates and likes. Quote the latest one in the first line of the draft. Posts often name employees, so store only `date` and `likes_count` and read the text when you write the draft.
- **Lead score:** rank companies by `followers`, `founded` and how many senior titles step 3 found there, and draft for the top 20 first.
- **Watch the list:** run `refresh.mjs` nightly and flag companies whose `employees_in_linkedin` or `followers` moved between runs. A hiring jump is a reason to write.
- **Mix in your CSV:** match uploaded leads to the dataset by company slug and fill in what the CSV lacks (card 01 does this one row at a time).
- **Any other profile:** swap industry, size band and HQ text. Keep `=` values to LinkedIn's exact labels, as in step 1.
