# What we tested

[Back to the hackpack](README.md)

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

These are results from the questions and runs described above, not a claim about every AI agent.
The cards include the requests, samples and limitations for each test.

For the radar comparison measured on October 22, see [the radar reference](radar/REFERENCE.md#why-not-just-ask-the-ai).
