# 01. A CRM that fills itself in

**The app people already build:** a CRM. Contacts, companies, a pipeline, notes. It works with no public data at all: you type everything in.

**What public data adds:** type a name and a company, and the CRM fills in the rest from public LinkedIn pages. You get their current title, location and follower count, plus the company's industry, size, employees on LinkedIn, HQ and website. A re-run that flags job changes is the next step (see Make it yours).

| Without public data | With public data |
|---|---|
| You type title, industry and company size by hand | Filled in from LinkedIn in under a minute (a few minutes on the fallback) |
| Data goes out of date over time | Click Enrich again to refresh a row |
| A name and a company | Title, followers, company size and HQ, so you know who you are talking to |

## Why not just ask the AI?

We asked Claude Code, with only its built-in web search and fetch tools, for 10 records: 5 well-known people and 5 well-known companies. Measured 2026-10-19:

- **Companies: the AI did fine.** 30 of 30 fields exact. The whole 10-record run took 45 s.
- **People: 17 of 25 fields exact.** It got 0 of 5 exact follower counts, because public pages show "12M". One profile blocked it outright (HTTP 999).
- **Scale:** it reads one page at a time. A plain script that reused one connection got HTTP 999 on 26 of 30 LinkedIn pages.

So for a few famous companies, the AI alone is enough. The scraper wins on exact person data, profiles that block plain fetches, and filling in every row in the background without anyone waiting.

## Paste this into your agent

Open Claude Code or Cursor in this repo, then:

```
Read AGENTS.md and ideas/01-crm-autofill/README.md first.

Add LinkedIn enrichment to the CRM in crm/ (Node 20+, no npm install, keep it that way):
1. Add an "Enrich" button on each contact row. It starts a job on the server and returns
   right away. The row shows "enriching..." and the page polls until the job is done
   (15 to 57 s per contact when Google answers; up to about 4 minutes when it falls back
   to the people search, so give the job at least 10 minutes before marking it failed).
2. The job uses enrichContact() from ideas/01-crm-autofill/enrich.mjs: it finds the
   LinkedIn profile from name + company when linkedin_url is empty, scrapes the person,
   then scrapes their current company.
3. Save on the contact: title, location, followers, linkedin_url, and the company's
   industry, size, employees on LinkedIn, HQ and website, plus enriched_at.
4. If the name check fails, company_match is false, or the contact has no company, save
   nothing and show "check identity" on the row. If the contact has a company but
   company_match is null, the profile lists none: save nothing and show "cannot verify: no
   company on profile" with the profile link, so a human can confirm.
5. Show the new fields in the table, with the follower count formatted (12,236,210).
Test it on the sample contacts. Never print the API key.
```

Building your own app instead of `crm/`? Copy `AGENTS.md` and this folder into your project and change step 2 to point at your code.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Find the profile URL (skip if you have it) | Google through Web Unlocker: `site:linkedin.com/in "<name>" <company>` with `brd_json=1`. Take the first `organic[]` result whose title starts with the name. | 2.1 to 19.8 s. With the company in the query, 3 of 3 CEOs were found end to end. 2 of 12 calls failed quietly (see Traps). |
| 1b. Or search by name (fallback) | Web Scraper API trigger, LinkedIn people search scraper `gd_m8d03he47z8nwb5xc`, input `{"url": "https://www.linkedin.com", "first_name": "<First>", "last_name": "<Last>"}`. Keep the same-name record whose `subtitle` mentions the company. | 3 names in one job: 82.5 s, all 3 at rank 1. One name per job, 3 jobs at once: Jensen Huang 64.2 s, Lisa Su 69.5 s, Satya Nadella 164.3 s, all the right profile. |
| 2. Scrape the person | Web Scraper API, dataset `gd_l1viktl72bvl7bjuj0`, input `{"url": "https://www.linkedin.com/in/<slug>"}` | 12 to 60 s for one. A batch of 10 went async and took 99.8 s. |
| 3. Check identity | Compare the record's `name` and `current_company.name` with your row. | 2 of 13 slugs we tried belonged to someone else with the same name. |
| 4. Scrape the company | Web Scraper API, dataset `gd_l1vikfnt1wgvvqz95w`, input `{"url": "https://www.linkedin.com/company/<current_company.company_id>"}` | 4.5 to 23.9 s for one. 10 took 56.5 s; 35 took 34.9 s async. |

Request shapes are in [AGENTS.md](../../AGENTS.md). [`enrich.mjs`](enrich.mjs) does all four steps, plus the fallback, in about 300 lines with no dependencies:

```
node ideas/01-crm-autofill/enrich.mjs "Jensen Huang" "NVIDIA"
```

End to end on 2026-10-19: Satya Nadella, Jensen Huang and Lisa Su from name and company only. All three passed the name and company checks with a full company record, in 15.4 to 56.6 s each (run in parallel). A fresh Claude Code session given an earlier version of the prompt above (steps 1 and 4 were reworded since) built the Enrich button into `crm/` in 7.3 minutes and enriched all three in 22.1 to 42.9 s each.

**Fields you get.** Person: `name`, `position`, `current_company` (`name`, `company_id`, `title`), `city`, `country_code`, `followers` (exact), `connections`, `experience[]` with start dates, `education[]`. Company: `industries`, `company_size`, `employees_in_linkedin`, `headquarters`, `website`, `followers`, `founded`, `organization_type`, `specialties`, `updates[]` (recent posts).

How complete: on 48 company records, `industries`, `company_size`, `employees_in_linkedin` and `followers` were present 48 of 48, `headquarters` and `website` 47, `founded` 37.

## Sample

[`sample.json`](sample.json) has trimmed real records (public figures only), with field names exactly as the API returns them, plus one error record. One person:

```json
{
  "url": "https://de.linkedin.com/in/satyanadella",
  "name": "Satya Nadella",
  "position": "Chairman and CEO at Microsoft",
  "current_company": { "name": "Microsoft", "company_id": "microsoft", "title": "Chairman and CEO" },
  "city": "Redmond, Washington, United States",
  "followers": 12236210,
  "connections": 500,
  "timestamp": "2026-10-19T19:07:19.529Z"
}
```

## Traps

- **Google through Web Unlocker sometimes fails quietly.** 2 of 12 calls came back as a 200 with an empty body and `x-brd-error-code: captcha`; in a later test, 3 of 6 parallel calls did. Once a 200 carried a text message instead of JSON, and once Google ignored `site:` and returned NVIDIA's home pages. `enrich.mjs` tries up to 4 times, asks again when no `/in/` links come back, and then falls back to the people search scraper (step 1b), which is slower but does not go through Google. A missing key or zone, or an HTTP 401 or 403, stops it with an error instead of falling back.
- **A slug is not an identity.** Two of 13 slugs that looked like famous CEOs' returned other people with the same name. Always compare name and company before saving.
- **Errors arrive inside a 200.** Hidden profiles come back as `{"error_code": "dead_page", "error": "The profile is hidden or private."}`. Check every record.
- **`position` can be null** on public profiles (4 of 9 CEOs). On all 4, `current_company.title` and `experience[]` were empty too, so expect a null title. `enrich.mjs` still tries both, but show the row with the title blank.
- **`current_company` can be empty on the right profile** (2 of 9 CEOs: no company, position or experience at all). Then nothing confirms the company and no company is scraped: `enrich.mjs` sets `checks.company_match` to `null`. Show "cannot verify: no company on profile", not a mismatch.
- **Exact follower counts only come from the scraper.** The public page, markdown and Google snippets all show "12M".
- **Partial records have no error flag.** Amazon's company record came back with no HQ, website or about. Treat "no HQ and no website" as partial.
- **`additional_information` "open jobs" is not the company's openings.** It is a LinkedIn-wide keyword total ("Engineer (555,845 open jobs)"). Ignore it.
- **`website` can be a vanity or redirect link** (Figma returned a figma.bot link).
- **URLs come back on locale subdomains with mixed case** (`https://ph.linkedin.com/in/Jenhsunhuang`). Normalize before you compare or store.
- **Batches go async.** Ten people took 99.8 s. Never make a user click wait on it.
- **`employees_in_linkedin` is a signal, not a headcount.** It often sits outside the listed size band.

## Make it yours

- **Job-change alerts:** re-enrich every contact weekly and flag when `current_company` or the title changes. That is the moment to reach out.
- **Enrich on import:** drop in a CSV of 200 contacts and run one batch job with the trigger endpoint instead of 200 single calls.
- **Conversation starters:** the company record has `updates[]`, its recent posts with likes. Show the latest one next to the contact.
- **Lead score:** rank the pipeline by company size band, follower growth between runs, and seniority words in the title.
