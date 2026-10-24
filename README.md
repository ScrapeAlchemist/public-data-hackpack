# Public Data Hackpack

Ten app ideas for hackers who build with Claude Code or Cursor. Each one starts with an app people
already build, one that works fine with no public data, and shows what live public web data adds.

From the Bright Data workshop "The Unfair Advantage: Live Web Data" at Cal Hacks 13
(October 23-25, 2026).

A CRM works without public data: you type the contacts in. Add public LinkedIn data and it fills
itself in. That is the pattern in every card here.

Everything your agent needs to use Bright Data's tools is in its agent skills:
https://github.com/brightdata/skills. Install them with `npx skills add brightdata/skills`.

## Start here: the AI radar

[`radar/`](radar/) is the workshop demo. One Run button gets today's top posts on r/LocalLLaMA,
the latest posts from five AI lab accounts on X, and the most-starred new LLM repos on GitHub,
side by side, in about a minute. Every run is saved, so the next one can tell you what is new.
After [SETUP.md](SETUP.md) (your key in `.env`, a Web Unlocker zone):

```
node radar/server.mjs
```

Open http://localhost:3001 and press Run. Your agent can browse, so we asked it for the same three
lists: it got GitHub (10 of 10), and 0 of 10 Reddit posts and 0 of 5 X accounts (measured
2026-10-22). It is a small example on purpose: [radar/README.md](radar/README.md) has the
measured routes, a prompt that scales it, and how to run it every morning at home (Take it home).

## The 10 ideas

| # | The app people already build | What public data adds | Data from |
|---|---|---|---|
| [01](ideas/01-crm-autofill/) | A CRM | Type a name and a company: title, location, exact followers, company size, HQ and website fill in. | LinkedIn people and companies |
| [02](ideas/02-sales-agent/) | An outreach agent that drafts emails for a lead list you upload | Pick an industry, size and HQ and it builds the list itself: 987 companies, then 554 people by title at 319 of them. Drafts only. | LinkedIn company and people datasets |
| [03](ideas/03-recruiter/) | A resume screener | Lines each resume up against the public profile and flags mismatches in titles, dates and schools for a recruiter to check. | LinkedIn people |
| [04](ideas/04-hiring-signals/) | A stock watchlist | Open roles per team, every day, charted. | Company careers APIs, Tesla's careers page, LinkedIn jobs |
| [05](ideas/05-price-watch/) | An online store's admin page | The same product's price at Amazon and Walmart every day, and at Target when it sells it, with an alert when someone undercuts you. | Amazon, Walmart, Target |
| [06](ideas/06-influencer-crm/) | A creator partnerships CRM | Exact followers, engagement on the last 12 posts and posting frequency, refreshed weekly. | Instagram, YouTube, X |
| [07](ideas/07-brand-monitor/) | A product feedback board | Counts public posts per day: Reddit posts and new YouTube videos found by searching for the product, plus Trustpilot and G2 ratings. | Reddit, YouTube, Trustpilot, G2 |
| [08](ideas/08-restaurant-dashboard/) | A restaurant owner's dashboard | Every competitor in the same category within a mile, with exact rating and review count, weekly, with places new since the last scan tagged. | Yelp |
| [09](ideas/09-small-business-lender/) | A small business loan intake | A public data panel per applicant: weekly Yelp rating and review count, hours, open roles, LinkedIn company data. For a human underwriter. | Yelp, careers APIs, LinkedIn companies |
| [10](ideas/10-pay-ranges/) | An internal comp tool | Posted salary ranges for the same role and city, monthly, so you can check every band and offer against them. | LinkedIn jobs, Indeed, careers APIs |

## How to use a card

1. Do [SETUP.md](SETUP.md) once (about 10 minutes): a Bright Data API key in `.env`, Node 22+.
2. Install Bright Data's agent skills in the repo folder: `npx skills add brightdata/skills`.
   https://github.com/brightdata/skills has everything your agent needs to use Bright Data's
   tools, for this card and whatever you build after it.
3. Open this repo in Claude Code or Cursor.
4. Open a card and copy its **Paste this into your agent** block into your agent. The agent reads
   [AGENTS.md](AGENTS.md) and the card, then builds a small working app in `apps/<name>/` (card 01
   extends `crm/` instead; Node 20+, no `npm install`) and tests it on a small real input.
5. Make it yours. Every card ends with ways to take it further.

Every card has the same parts:

- **Without / with:** what the app does today and what public data adds.
- **Why not just ask the AI?** We asked Claude Code for the same data, with only its built-in
  web search and fetch tools and no Bright Data. The card says what it got right and where it stopped.
- **The route:** the exact requests that returned the data on 2026-10-19, with timings.
- **A sample:** `sample.json`, trimmed real records with the field names exactly as returned.
- **Traps:** what broke, and how to get around it, including when you do not need Bright Data at all.

Building your own app instead? Copy `AGENTS.md` and the card's folder into your project. Cards 03,
09 and 10 also use code from elsewhere in this repo, so copy it too: card 03 needs
`ideas/01-crm-autofill/enrich.mjs`, card 09 needs `ideas/08-restaurant-dashboard/yelp_competitors.mjs`
(or write the parser from step 1 of its route), and card 10 needs `examples/intern-intel/js/parsers.mjs`
plus `compat.mjs` from the same folder.

## Why not just ask the AI?

Your agent already has web search and fetch. For a few famous records that is often enough, and
the cards say so. Here is what it did on each card's own question, measured 2026-10-19:

| Card | What the AI alone got right | Where it stopped |
|---|---|---|
| 01 CRM | Companies: 30 of 30 fields exact | People: 0 of 5 exact follower counts; one profile blocked it (HTTP 999) |
| 02 Sales agent | Asked for up to 40, it found 35 real matching companies, every field exact | 35 companies in 314.6 s and 112 tool calls; the dataset returned 987 in 292.6 s |
| 03 Recruiter | Title, company and location exact for 4 of 5 people | One profile returned HTTP 999 twice |
| 04 Hiring signals | Open careers APIs: Stripe's 723 jobs and 208 department counts exact | Tesla returned 403, Microsoft 429; today's count only |
| 05 Price watch | It made nothing up | 1 of 15 prices; 0 of 10 even with the exact Amazon and Walmart URLs |
| 06 Influencer CRM | YouTube: 18 of 25 fields exact, from the public RSS feed | Instagram: 6 of 20; rounded followers and no likes |
| 07 Brand monitor | It made nothing up | 0 of 37 Reddit posts and YouTube videos; a second run read an old archive |
| 08 Restaurant | 7 of 10 nearby competitors by name | 0 ratings, review counts or prices; Yelp returned 403 |
| 09 Lender | One named business: rating and review count right. LinkedIn companies: 30 of 30 fields exact | Tesla's job board returned 403 |
| 10 Pay ranges | 10 of 10 pay ranges exact | All 10 came from just 3 company job boards |

The pattern: the AI is fine for one lookup. Public data at scale wins on pages that block plain
fetches, exact numbers, many records at once, and a job that keeps them current with nobody asking.

## What is in this repo

```
radar/                 the workshop demo: an AI radar for Reddit, X and GitHub (Node 20+, no npm install)
ideas/                 the 10 cards: README.md, sample.json, and a reference script for 01, 07, 08
crm/                   a small starter CRM (Node 20+, no npm install), used by card 01
examples/intern-intel/ a finished example: internships from Indeed and Glassdoor in one table
AGENTS.md              instructions for your coding agent: keys, zones, the four Bright Data calls
CLAUDE.md              points Claude Code at AGENTS.md
SETUP.md               API key, .env, MCP connection, agent skills, smoke test
.env.example           copy to .env and add your key
```

To try the starter CRM, run `node crm/server.mjs` from the repo root, then open
http://localhost:3000. On first start it copies the demo contacts from `crm/data/seed.json` to
`crm/data/contacts.json`, which git ignores, and saves every change there. To get the
un-enriched demo back, stop the server, delete `crm/data/contacts.json` and start it again.

The apps call the Bright Data REST API from their own server code, so a scheduler or a server can
run them with no agent attached. While you explore, the Bright Data MCP server gives your agent the
same tools (see SETUP.md).

## Bright Data tools this builds on

- Hosted MCP server: `https://mcp.brightdata.com/mcp` (setup in [SETUP.md](SETUP.md)).
  Source: https://github.com/brightdata/brightdata-mcp
- Agent skills, everything your agent needs to use Bright Data: https://github.com/brightdata/skills
- CLI: https://github.com/brightdata/cli
- Per-site starter repos with field tables and sample output:
  [linkedin-scraper-python](https://github.com/brightdata/linkedin-scraper-python),
  [linkedin-scraper-node](https://github.com/brightdata/linkedin-scraper-node),
  [instagram-scraper-python](https://github.com/brightdata/instagram-scraper-python),
  [instagram-scraper-node](https://github.com/brightdata/instagram-scraper-node),
  [amazon-scraper-python](https://github.com/brightdata/amazon-scraper-python),
  [amazon-scraper-node](https://github.com/brightdata/amazon-scraper-node)

## Bright Data prize track

Bright Data runs a prize track at Cal Hacks 13. See the Cal Hacks 13 prize list for the rules and
judging. Our advice: pick an app people already use, make live public data do real work in it,
and show it running in the demo.

## One rule

Public data only: what a logged-out visitor can see. No logins, no cookies from a session, no paywalls.
