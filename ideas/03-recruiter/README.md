# 03. A resume checker with public profiles

Compare a resume with the person's public LinkedIn profile. Show titles, employers,
dates and education side by side, and flag differences for a recruiter to review.
A missing field means it could not be checked; a difference is a question to ask.

The prompt creates `apps/screener/`. The recruiter makes the decision; the app does not reject applicants.

## Paste this into your agent

Finish [setup](../../SETUP.md), then open this project in Claude Code or Cursor.
Expand the prompt below and paste the whole block into your agent. It will build
the app and test it with a small real input using your Bright Data account.

<details>
<summary>Copy the build prompt</summary>

```
Read AGENTS.md and ideas/03-recruiter/README.md first.

Build a resume screener in apps/screener/ (Node 20+, built-in fetch and node:http, plain
HTML/JS, JSON files for storage, no npm install):
1. One page: paste a job description, add applicants (name, current company, resume text,
   optional public profile URL; when given, skip step 1 of the route and still check
   identity). If an LLM key is in .env, rank applicants against the job; otherwise skip
   ranking.
2. Turn each resume into claims the human can correct in a small form: current title,
   employer, start year of the last 2 roles, schools with end years. Strip emails and
   phone numbers from resume text before you store it.
3. A "Check profiles" button starts a background job and returns at once; the page polls
   for status. Never call Bright Data inside a page request.
4. The job: import findProfileUrl, scrape, sameName and mentionsCompany from
   ideas/01-crm-autofill/enrich.mjs. Scrape the URL with gd_l1viktl72bvl7bjuj0. Wrong
   name or company: "check identity". dead_page or no URL: "no public profile". Neither
   one is a mismatch.
5. Compare claims with experience[] (flatten positions[], match every role ending "Present")
   and education[], at year level. Each field gets "match", "mismatch" or "cannot verify".
6. Append each run to apps/screener/data/runs.json with fetched_at and the profile URL. Show
   resume vs profile vs flag per applicant, and what changed since the last run.
7. Add apps/screener/refresh.mjs that re-checks every stored applicant, for a scheduler.
Gitignore apps/screener/data/ (applicants are private). Never auto-reject or print the key.
Check the field mapping against the real records in this card's sample.json.
Test one live public profile URL from that sample, and check its returned fields.
For resume comparisons, ask the user for real claims to check; do not invent resumes
or a mismatch. Use "cannot verify" whenever the available evidence is insufficient.
```

</details>

## Make it yours

- Turn a difference into a question for the interview.
- Check the shortlist again before making offers.
- Show public company information beside each profile.

<details>
<summary>Build reference: API requests, sample data and test results</summary>

The rest of this card is for your coding agent and anyone changing how the app
collects data. Keep these instructions with the prompt.

### Adding this to an existing app

Building into an existing screener instead? Copy `AGENTS.md` and this folder into your project, plus `ideas/01-crm-autofill/enrich.mjs` next to it (step 4 of the prompt imports from there), and point steps 1 and 6 at your code.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Find the profile URL | Google through Web Unlocker: `site:linkedin.com/in "<First Last>" <Company>` with `brd_json=1`. Keep `organic[]` results whose `link` has `/in/` and whose `title` starts with the name; prefer the one that mentions the company. | 5.8 to 19.8 s. In the first run 5 of 6 well-known names were result 1 (Lisa Su was missed); a later run found her (`lisasu-amd`). Results are direct `linkedin.com/in` links. |
| 1b. Or search by name | Web Scraper API trigger, LinkedIn people search scraper `gd_m8d03he47z8nwb5xc`, input `{"url": "https://www.linkedin.com", "first_name": "<First>", "last_name": "<Last>"}` | 82.5 s for a batch of 3 names. 3 of 3 targets at rank 1, inside 60 records: 11, 3 and 46 people with the same name. One name per job, 3 jobs at once: 64.2, 69.5 and 164.3 s. |
| 2. Scrape the profile | Web Scraper API, LinkedIn people profiles scraper `gd_l1viktl72bvl7bjuj0`, input `{"url": "https://www.linkedin.com/in/<slug>"}` | 12 to 60 s for one. A batch of 10 went async and took 99.8 s. |
| 3. Check identity | Compare the record's `name` and `current_company.name` (or `experience[]` companies) with the applicant. | 2 of 13 slugs we tried belonged to someone else with the same name. 2 more were hidden (`dead_page`). |
| 4. Compare | Resume claims vs `experience[]` and `education[]`. No call. | Of 9 correct profiles, 5 had `experience[]` with start dates, 6 had `education[]`, 5 had school years. |

Request shapes are in [AGENTS.md](../../AGENTS.md). [`findProfileUrl()`](../01-crm-autofill/enrich.mjs) in card 01 already does step 1, with the retries and the company preference, and falls back to step 1b when Google keeps failing. Import it, along with `scrape()`, `sameName()` and `mentionsCompany()`.

**Fields you get.** Profile: `name`, `position`, `current_company` (`name`, `company_id`, `title`), `city`, `about`, `experience[]` and `education[]`. A flat `experience[]` entry has `title`, `company`, `company_id`, `start_date`, `end_date`. When someone held several roles at one company the entry has `title` (the company name), `duration` and `positions[]`, each with `title`, `start_date`, `end_date` and `meta` ("Apr 2020 - Present 6 years 7 months"). `education[]`: `title` (the school), `degree`, `field`, `start_year`, `end_year`. People search: `name`, `url`, `location`, `subtitle`, `experience`, `education`, `avatar`, `timestamp`. Google: `organic[]` with `link`, `title`, `description`, `display_link`, `rank`.

How complete: on 9 correct public CEO profiles, `current_company` was present on 7, `education[]` on 6, `position` on 5 and `experience[]` on 5. Plan for "cannot verify" as a normal result.

## Sample

[`sample.json`](sample.json) has trimmed real records (public figures only): two Google results, two people search results, three profiles (full, nested, sparse) and one error record, with field names exactly as the API returns them. The shape that trips parsers, several roles at one company:

```json
{
  "url": "https://ar.linkedin.com/in/Arvindkrishna",
  "name": "Arvind Krishna",
  "position": "Chairman and Chief Executive Officer, IBM",
  "current_company": { "name": "IBM", "company_id": "ibm", "title": "Chairman" },
  "experience": [{
    "title": "IBM", "company": "IBM", "duration": "35 years 11 months",
    "positions": [
      { "title": "Chairman", "start_date": "Jan 2021", "end_date": "Present" },
      { "title": "Chief Executive Officer", "start_date": "Apr 2020", "end_date": "Present" },
      { "title": "Senior Vice President, Cloud and Cognitive Software", "start_date": "Jan 2019", "end_date": "Apr 2020" }
    ]
  }],
  "education": [
    { "title": "University of Illinois at Urbana-Champaign", "degree": "Doctor of Philosophy - PhD", "start_year": "1985", "end_year": "1991" }
  ],
  "timestamp": "2026-10-19T19:07:32.346Z"
}
```

## Traps

- **Applicants are private people.** Only check people who applied to your role. Keep `data/` and `cache/` out of git, strip emails and phone numbers from resumes before storing, store only the fields you compare (skip `avatar`), and demo on public figures.
- **A slug is not an identity.** Two of 13 slugs that looked like famous CEOs' returned other people with the same name. In a screener that means flagging a real applicant with a stranger's profile. If the name or company does not match, show "check identity", never "mismatch".
- **Same names pile up.** The people search scraper returned 11, 3 and 46 people for three names. Disambiguate by company. Marc Benioff's `subtitle` was null and his Google title did not mention Salesforce, so when nothing names the company, ask the human for the profile URL.
- **Missing is not a mismatch.** Of 9 correct CEO profiles, 4 had no `experience[]` and 4 had a null `position`. Benioff's record had no `current_company`, `experience` or `education` at all. Show "cannot verify".
- **Several roles at one company nest.** On 3 of the 5 profiles with experience (Krishna, Barra, Pichai), `experience[0].title` is the company name, its `start_date` is null, and the dated roles sit in `positions[]`. Barra has two separate General Motors entries. Flatten both shapes before you compare.
- **More than one role ends in "Present".** Krishna's profile has Chairman since Jan 2021 and Chief Executive Officer since Apr 2020, and `current_company.title` says only "Chairman". Nadella's board seat also ends in "Present". Match the resume title against every current role, not the first.
- **Dates come in two precisions.** `start_date` is "Feb 2014" or just "1993". Compare at year level when either side has only a year. Some schools have no years: Pichai's 3 schools had none.
- **Text has non-ASCII punctuation.** Barra's titles use an en dash (U+2013) and Nadella's degree is `Bachelor\u2019s Degree`. Normalize punctuation and case before comparing strings.
- **Errors arrive inside a 200.** Hidden profiles (`chuckrobbins`, `williamrmcdermott`) come back as `{"error_code": "dead_page", "error": "The profile is hidden or private."}`. That means "no public profile", not a red flag.
- **Google fails quietly.** In a re-test, 2 of 12 Google calls came back as an empty 200 with `x-brd-error-code: captcha` (later 3 of 6 parallel calls), and now and then Google ignores `site:` and returns generic results. `findProfileUrl()` retries, then falls back to the people search scraper (step 1b).
- **Not Yandex, not `discover_by=name`.** Yandex through Web Unlocker found 1 of 3 names: one failed with `reject_element` and one timed out twice at 180 s. Yandex through a SERP zone found 0 of 3. `discover_by=name` on the profiles dataset returns HTTP 400 "Incorrect discovery collector id". Use Google or the people search scraper.
- **Plain fetch works until it does not.** Fresh logged-out GETs (5 of one profile page, 5 of one company page, new connection each time) returned 200 on 10 of 10, in about 1 s each. One script that reused one connection over 30 profile and company pages got HTTP 999 on 26, from the 2nd request on. Fine for a one-off look; use the scraper for a stack of applicants.
- **URLs come back on locale subdomains with mixed case** (`https://ar.linkedin.com/in/Arvindkrishna`). Normalize before you compare or store.
- **It is slow, so it is a job.** 10 profiles took 99.8 s; the people search took 82.5 s for 3 names. Never make a recruiter's click wait on it.

## Why not just ask the AI?

We asked Claude Code, with only its built-in web search and fetch tools, for current LinkedIn data on 5 well-known people (and 5 companies). Measured 2026-10-19:

- **Current title and employer: the AI did fine.** 17 of 25 people fields exact, 0 wrong. Title, company and location were exact for 4 of the 5 people.
- **One profile blocked it.** Sundar Pichai's page returned HTTP 999 twice, so his title, company, location and followers came back empty. The other 4 misses were exact follower counts, which a screener does not need.
- **Start dates and education: not measured.** We did not ask the AI for them.
- **Scale:** it reads one page at a time. A plain script that reused one connection got HTTP 999 on 26 of 30 LinkedIn pages.

So to check one famous person's current job, the AI alone is enough. The measured gap is the profile that blocks a plain fetch, and checking a whole stack of applicants in the background, with start dates and school years as fields you can compare (see below), while nobody waits.

### More build ideas

- **Interview prompts:** turn each mismatch into a neutral question the recruiter can ask ("Your profile shows a different start date at IBM. Can you walk me through it?").
- **Re-check before the offer:** run `refresh.mjs` on the shortlist and show what changed since the first check (new title, new employer).
- **Batch the stack:** 30 resumes become one trigger job with all 30 profile URLs instead of 30 single calls.
- **Employer context:** add the LinkedIn company scraper from card 01 (`gd_l1vikfnt1wgvvqz95w`) to show the current employer's industry and size next to each applicant.
- **Sourcing, not just screening:** card 02's step 3 ran Filter Dataset on the people profiles dataset (`gd_l1viktl72bvl7bjuj0`) with `current_company_company_id` `in` the 956 company slugs from its company filter, AND one OR group of `position` includes VP, Head of, Director, Chief. It returned 554 people at 319 of those companies in 1074.2 s. The body is in [card 02](../02-sales-agent/README.md). Build it ahead of time, and show counts and titles in a demo, not names.

</details>
