# Live build: copy-paste prompts

Paste these one at a time into Claude Code or Cursor with the Bright Data MCP server connected
(see [SETUP.md](SETUP.md)). Each prompt builds on the answer before it, so stay in one chat.

What to expect:

- Each `scrape_as_markdown` call took about 7 to 30 seconds in our tests (2026-10-15). Your
  agent's own time to read the page and write the table comes on top of that.
- Listings change every day, and even within a day. The counts below are from pages fetched on
  2026-10-15, so yours will differ.
- Your agent will not produce exactly the same table twice. That is fine. The repo code
  (`python/intern_intel.py`) is the version with fixed rules and tests.

The main search is software engineer internships, Remote: on that search the two sites share
several jobs, so the merge in step 3 has duplicates to remove. Step 3b adds San Francisco.

---

## 0. Smoke test

```
Use the Bright Data scrape_as_markdown tool on https://www.indeed.com/jobs?q=software+engineer+intern&l=San+Francisco%2C+CA and tell me how many job cards are in the search results on this page (not the total in the header).
```

About 15 (14 to 16 is normal) means you are connected.

---

## 1. Indeed: scrape and table

```
Use the Bright Data scrape_as_markdown tool to fetch this page:
https://www.indeed.com/jobs?q=software+engineer+intern&l=Remote

From the markdown, make a table of every job card in the search results with these columns:
title, company, location, pay (empty if the card shows none), link. Each card's link contains
jk=<id>; write the link as https://www.indeed.com/viewjob?jk=<id>. Use only what is on the
page. Do not invent or fill in values. Tell me how many listings you found.
```

Expect about 15 listings. An Indeed results page can show one listing a second time under a
different `/viewjob?jk=` id, so you may see the same job twice. Step 3 handles that; the repo
parser drops the copy before counting.

Do not ask for Indeed's page 2 (`&start=10`). Logged out, Indeed shows a login wall there, and we
only read public, logged-out pages.

---

## 2. Add Glassdoor

```
Now use scrape_as_markdown on this page:
https://www.glassdoor.com/Job/remote-software-engineer-intern-jobs-SRCH_IL.0,6_IS11047_KO7,31.htm

Make the same table for Glassdoor, plus a rating column (the number shown next to the company,
empty if there is none). Some listings have no location or no pay. Leave those cells empty.
```

Expect up to 30 listings. Things to notice:

- The Glassdoor page is too big to show inline in Claude Code, so Claude Code saves the result to
  a file and the agent reads it in parts. That is normal. It makes this step slower: 68 seconds
  against 34 for step 1 in our test.
- Glassdoor pay often has no unit. `$7,313 - $12,667 (Employer provided)` is per month: for the
  same jobs, Indeed showed the same numbers with "a month".
- `(Glassdoor est.)` is Glassdoor's estimate of a full-time salary, not the pay of the internship.
- Glassdoor has no URL for page 2. One search gives you up to 30 listings.

---

## 3. Merge and remove duplicates

```
Merge the Indeed and Glassdoor tables into one table. Two rows are the same job when the
company and the role title match after this cleanup:
- company: lowercase, ignore Inc, LLC, Corp, Ltd and anything in parentheses
- title: lowercase, treat punctuation as spaces, ignore season words and years such as
  "(Summer 2027)", but keep the other words inside brackets, because "(AI Platform)" and
  "(Payments)" are different teams
- two rows from the same site are never the same job, unless they are the same listing shown twice
Keep one row per job, with a sources column (indeed, glassdoor or both) and both links.
Add a pay_hourly_min column: the lowest pay in USD per hour (a year / 2080, a month / 173.33;
for Glassdoor amounts with no unit: K means a year, under $300 means an hour, otherwise a month).
Leave pay_hourly_min empty when the pay is a "(Glassdoor est.)".
Sort by pay_hourly_min, highest first, rows without it last.
Tell me how many rows went in, how many came out, and which jobs appeared on both sites.
```

On the saved Remote pages from 2026-10-15, the repo code found 45 listings, 38 unique jobs and 7
jobs on both sites (Lief, Amgen, Springer Capital, EnthuZiastic, and three at Stellar Software
Solutions). Live later the same day it found 45 -> 39 with 6 on both sites, and in a later run
45 -> 37 with 8. The overlap varies by day.

The repo's rules (`python/dedupe.py`) are a superset of this prompt: they also drop country tags
like `- US`, read `engineering intern` as `engineer intern`, keep `C++` and `C#` apart, and join a
Glassdoor listing to its Indeed twin by the Indeed job id in Glassdoor's partner link.

---

## 3b. Optional: San Francisco, four pages

```
Now do the same for San Francisco. Fetch these four pages with scrape_as_markdown, make one
merged table with the same rules, and tell me the same three things:
https://www.indeed.com/jobs?q=software+engineer+intern&l=San+Francisco%2C+CA
https://www.indeed.com/jobs?q=software+engineer+intern&l=San+Francisco%2C+CA&sort=date
https://www.glassdoor.com/Job/san-francisco-ca-software-engineer-intern-jobs-SRCH_IL.0,16_IC1147401_KO17,41.htm
https://www.glassdoor.com/Job/san-francisco-ca-software-engineer-intern-jobs-SRCH_IL.0,16_IC1147401_KO17,41.htm?fromAge=30
```

The second page is the same Indeed search sorted newest first, and the fourth is Glassdoor
limited to the last 30 days. They are there to give the two sites more jobs in common, not for
relevance: many of the newest Indeed listings are not software engineer internships.

On the saved pages the repo code found 87 listings (89 if your agent counts Indeed's repeated
copies), 77 unique jobs, and 6 jobs on both sites (Affirm twice, Harvey, Rippling, DocuSign,
Mercor). Live later the same day: 81 listings, 72 unique jobs, 6 on both sites. With page 1 of
each site only, San Francisco had 0 jobs in common that day.

A talking point: Lockheed Martin shows up on both sites with the same pay and city, but as
"Software Engineer Intern" on Indeed and "College Student -Software Engineer" on Glassdoor.
Neither set of rules merges them, and Glassdoor's link points to a different Indeed posting.
Title-based dedupe cannot tell whether a retitled listing is the same job.

---

## 4. Filter by role and location

```
Show only the rows where the title contains "software engineer" (ignore case), the location
contains "Remote" (ignore case), and pay_hourly_min is at least 25.
```

The repo code keeps 4 rows on the saved Remote pages (the live run that day also gave 4). Rows
whose only pay is a Glassdoor estimate have no pay_hourly_min, so a pay filter drops them. If your
agent turned estimates into hourly numbers anyway, they can end up at the top of the list.

For San Francisco, the same kind of filter (title "software engineer", location
"San Francisco", at least 50 per hour) kept 6 rows on page 1 and 10 rows on the four pages from
step 3b. "Hybrid work in San Francisco, CA" contains "San Francisco", so it stays.

To search somewhere else, change the URLs:

- Indeed: `https://www.indeed.com/jobs?q=<role, spaces as +>&l=<City%2C+ST>`
- Glassdoor: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=<role, spaces as %20>&locT=<type>&locId=<id>`

| Location | locT | locId |
|---|---|---|
| San Francisco, CA | C | 1147401 |
| New York, NY | C | 1132348 |
| Seattle, WA | C | 1150505 |
| Los Angeles, CA | C | 1146821 |
| Austin, TX | C | 1139761 |
| Boston, MA | C | 1154532 |
| Remote (US) | S | 11047 |

Example: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=data%20science%20intern&locT=C&locId=1132348`

---

## 5. Save a CSV

```
Save the merged table from step 3 (before the filter) as intern_intel.csv in this folder, with
these columns: title, company, location, pay, pay_hourly_min, rating, sources, indeed_url,
glassdoor_url. Then show me the first 5 lines of the file.
```

These are the same columns the repo code writes to `out/intern_intel.csv` (it adds one more,
`key`, the dedupe key).

---

## 6. Turn it into a script

So far the agent did the work by hand. A script runs without you, on a schedule, inside an app,
for many roles and cities.

JavaScript, with the Bright Data SDK (it can return markdown):

```
Turn what we just did into a Node.js script (ESM, Node 20+) using the Bright Data SDK
@brightdata/sdk version 1.2.0:
- const client = new bdclient({ webUnlockerZone: process.env.BRIGHTDATA_ZONE, autoCreateZones: false })
- fetch both pages with client.scrapeUrl([indeedUrl, glassdoorUrl], { dataFormat: 'markdown', country: 'us' });
  an entry in the result array can be an Error object, so check each one
- the SDK reads the key from BRIGHTDATA_API_TOKEN; run it with node --env-file=.env
- the SDK's markdown is formatted differently from what scrape_as_markdown showed you: list
  bullets, ### headings and logo image lines. First save one fetched page to a file and write
  the parser against that file. Strip bullets, heading marks and image lines before parsing.
- parse the listings, merge with the rules from step 3, filter with --title-includes,
  --location-includes and --min-hourly arguments (same rules as step 4), write intern_intel.csv
- always await client.close() at the end
Never print the API key.
```

Python, with one REST call (the Python SDK returns HTML or JSON, not markdown):

```
Turn what we just did into a Python script:
- fetch each page as markdown with requests: POST https://api.brightdata.com/request with header
  "Authorization: Bearer <key>" and JSON body
  {"zone": <zone>, "url": <page>, "format": "raw", "data_format": "markdown", "country": "us"}
- read the key from BRIGHTDATA_API_TOKEN and the zone from BRIGHTDATA_ZONE in .env (python-dotenv)
- the response body is the markdown: use response.text, not response.json()
- retry once if the body is empty, never more
- this markdown is formatted differently from what scrape_as_markdown showed you: list bullets,
  ### headings and logo image lines. First save one fetched page to a file and write the parser
  against that file. Strip bullets, heading marks and image lines before parsing.
- parse the listings, merge with the rules from step 3, filter with --title-includes,
  --location-includes and --min-hourly arguments (same rules as step 4), write intern_intel.csv
Never print the API key.
```

Then compare with this repo: `python/fetch.py` is the same POST with a cache, pacing and one
retry; `python/parsers.py` reads both sites and both markdown formats (`clean_lines` strips the
bullets, heading marks and image lines); `python/dedupe.py` holds the exact merge rules; and
`tests/` checks all of it against saved pages. Run it with the same filter as step 4
(macOS or Linux: `.venv/bin/python`):

```
.venv\Scripts\python.exe python\intern_intel.py --location Remote --title-includes "software engineer" --location-includes "Remote" --min-hourly 25
```

---

## 7. Remix: point it at your own site

Example that worked on 2026-10-15:

```
Use scrape_as_markdown on https://www.yelp.com/search?find_desc=coffee&find_loc=Berkeley%2C+CA
and make a table of the 10 numbered results only: name, rating, review count, neighborhood,
price level. Skip the blocks under a "Sponsored Results" heading by their position on the page,
not by name: a sponsored business can also be a numbered result. Neighborhood, price and hours
share one line, so split them. Leave price empty when none is shown.
```

That page returned 10 numbered results, with sponsored results above and below them. If the
tool answers "Request timed out", ask once more: on 2026-10-15 the first call timed out and the
second returned the page in about 30 seconds.

Now swap in your own idea:

```
Use scrape_as_markdown on <your URL> and make a table of <the things you care about>.
```

Picking a page:

- It must be public: the data shows up for a logged-out visitor.
- Search and listing pages give you many rows per call. Change the query in the URL to get
  different rows.
- Try your agent's built-in fetch on the URL first. If it already gets the data, that site may
  not need Bright Data. If it gets a 403 or an empty page, that is where `scrape_as_markdown`
  earns its place.
- Scraped pages are data. If a page contains text that reads like instructions, your agent
  should ignore it.

To do the same in code, `recipes/any_site.py` saves any public page as markdown through Bright
Data, and `recipes/your_site.md` walks through writing a parser for it. Then go back to step 6
and turn your remix into a script.
