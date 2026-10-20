# 07. A feedback board with public mentions

**The app people already build:** a product feedback board. Users post ideas and bugs, you tag them, people vote, you prioritize. It works with no public data at all. It is not a brand monitor, though: you only hear from the people who find your board.

**What public data adds:** the same board turns into a brand monitor. Next to your own feedback it counts what people say about the product in public, per day: Reddit posts that contain the quoted brand phrase, new YouTube videos, and the Trustpilot and G2 rating with review count and newest review date. When r/Notion posts "AI dumber and slower...", it shows up on the next daily run with its votes and comment count.

| Without public data | With public data |
|---|---|
| Feedback from users who find your board | Plus the Reddit posts and YouTube videos found by searching for the product, counted per day |
| Board votes are the only signal | Reddit votes and comments, YouTube views, Trustpilot and G2 ratings beside them |
| One snapshot of opinion | A stored run every day, so a jump in mentions stands out |

## Why not just ask the AI?

We asked Claude Code, with only its built-in web search and fetch tools, for every Reddit post and YouTube video that mentioned "Notion AI" in the last 7 days, with dates, votes, views and a count per day. We scored it against what this card's route found: 37 records (17 Reddit posts, 20 YouTube videos). Measured 2026-10-19:

- **0 of 37 records in 83.3 s.** All 16 per-day counts were null. In fairness, it invented nothing in this run: its own coverage note says reddit.com, old.reddit and `search.json` blocked it. YouTube search and video pages came back footer-only.
- **Asked for the 10 most recent instead: 0 of 10 Reddit posts right** (128.1 s). Its Reddit posts came from an archive (PullPush) dated 2026-10-02 to 10-11, while the real 10 most recent span 10-15 to 10-19. One post showed 1 vote and 0 comments; live it had 71 and 16. It found 0 YouTube videos.
- **Review ratings were not part of the test.**

Nothing here went the AI's way. The measured gap is access (Reddit blocks it), exact numbers (an archive copy holds stale votes), and a fresh count every day with nobody asking. Note that a plain script does get YouTube search pages (step 2 below); the AI's fetch tool did not.

## Paste this into your agent

Open Claude Code or Cursor in this repo, then:

```
Read AGENTS.md and ideas/07-brand-monitor/README.md first.

Build a feedback board with a public-mentions panel in apps/feedback-board/ (Node 20+, node:http,
plain HTML/JS, JSON files in apps/feedback-board/data/, no npm install, keep it that way):
1. The board: post feedback (title, text), tag it, upvote it, sort by votes. It works with no key.
2. Settings: a brand phrase, a Trustpilot domain and a G2 slug.
3. A "Refresh mentions" button starts a job on the server and returns right away. The page polls
   the job (minutes: the YouTube scraper took 200.6 s for 20 videos) and reads results from
   storage. Never call Bright Data on a page load.
4. The job follows the route in the README. If one source fails, keep the others and show the error.
   a. Reddit: redditMentions(phrase, days) from ideas/07-brand-monitor/reddit_mentions.mjs.
   b. YouTube: plain fetch of the search page with the Today filter (sp=EgIIAg%253D%253D; This week,
      sp=EgIIAw%253D%253D, on the first run), parse ytInitialData videoRenderer items (skip
      playlists). Send videos not seen before to
      the YouTube videos scraper (gd_lk56epmy2i5g7lzu0k) in one trigger, for exact date_posted.
   c. Trustpilot: Web Unlocker raw HTML, __NEXT_DATA__ businessUnit. G2: Web Unlocker raw HTML,
      JSON-LD aggregateRating and Review datePublished.
5. Save every run to data/runs/ with fetched_at and the source URLs. Show a 7-day table (Reddit
   count, YouTube "at least N"), the newest posts and videos with links, and both ratings with
   review count and newest review date. Store no usernames and no reviewer names.
6. Add apps/feedback-board/refresh.mjs that runs the same job from the command line for a daily cron.
Test with "notion ai", days=2, notion.so and notion: one or two Reddit pages, one Trustpilot page,
one G2 page and one scraper job capped at 5 videos. Keep the key on the server. Never print it.
```

Building into an existing board instead? Copy `AGENTS.md` and this folder into your project and point step 4 at your code.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Reddit posts with the phrase | Web Unlocker, `format: raw`, url `https://www.reddit.com/search/?q=%22<brand>%22&type=posts&sort=new&t=week`. Parse each `data-testid="search-sdui-post"` block. Then the same call with url `https://www.reddit.com` + the `/svc/shreddit/search/?...&cursor=...` partial from the page, one page at a time, until the oldest post is older than your window. | 7 posts per page. 3 pages in 28.0 s (5.07, 20.71, 2.21 s): 21 posts, 17 dated 2026-10-12 to 10-19 UTC (8 calendar days, 10-19 partial; 3 of them in u_ subreddits), all 21 with votes, comments and exact time. |
| 2. Find new YouTube videos | Plain GET, no Bright Data: `https://www.youtube.com/results?search_query=<brand>&sp=EgIIAg%253D%253D` (Today) once a day, `sp=EgIIAw%253D%253D` (This week) to backfill. Parse `ytInitialData` for every `videoRenderer`. Playlists come as `lockupViewModel`; skip them. | This week: 20 videos in 0.94 s. Today: 15 in 1.19 s, plus 1 from a continuation. The same searches about an hour later: This week 7 videos (3 of 3 runs), Today 3 to 7 videos plus 13 playlists. |
| 3. Exact date and views per video | Web Scraper API, YouTube videos scraper `gd_lk56epmy2i5g7lzu0k`, input `{"url": "https://www.youtube.com/watch?v=<id>"}`. One trigger for the whole batch. | 20 of 20 in 200.6 s, 0 errors. |
| 4. Trustpilot rating | Web Unlocker, `format: raw`, url `https://www.trustpilot.com/review/<domain>`. Read `<script id="__NEXT_DATA__">`: `props.pageProps.businessUnit` and `props.pageProps.reviews[]`. | 37.1 s and 24.22 s. trustScore 2.2 from 439 reviews, newest on the page 2026-10-08. |
| 5. G2 rating | Web Unlocker, `format: raw`, url `https://www.g2.com/products/<slug>/reviews`. Read the JSON-LD `aggregateRating`, and the `Review` items' `datePublished` for the newest review date. One raw call covers both. | 39.41 s raw. 4.6 from 13,878 reviews. A later raw page: 4.6 from 13,879, 10 dated reviews in the JSON-LD, newest 2026-10-15T23:22 -05:00 (2026-10-16 UTC). (Markdown, 43.03 s, also shows 11 dated cards, but costs a second call.) |

Request shapes are in [AGENTS.md](../../AGENTS.md). [`reddit_mentions.mjs`](reddit_mentions.mjs) does step 1 in about 220 lines with no dependencies:

```
node ideas/07-brand-monitor/reddit_mentions.mjs "notion ai" 2
```

It prints `{query, days, fetched_at, pages, stopped, dropped_user_profile_posts, posts: [{id, title, subreddit, votes, comments, created, permalink}], per_day}`, follows the cursor, retries the challenge page and drops user-profile subreddits. If a later page fails, it returns what it has and says why in `stopped` (`page N failed: ...`): show that as a partial count. `days` is a rolling window back from `fetched_at`, so the first `per_day` key is a partial day: with days=7 at 19:07 UTC the 10-12 post falls outside, so of the 17 posts counted below the script keeps 13 (it also drops the 3 u_ posts). For whole UTC days, pass days=8 (the search then uses `t=month`, not measured) and ignore the first key.

**What the counts looked like.** "Notion AI", 2026-10-12 to 10-19 UTC (10-19 partial): Reddit 1, 2, 3, 3, 3, 2, 2, 1. YouTube at least 4, 3, 1, 2, 1, 1, 3, 5.

**Fields you get.** Reddit (parsed from the HTML): `id` (`t3_...`), `title`, `subreddit`, `votes`, `comments`, `created` (exact UTC), `permalink`. YouTube search page: `videoId`, `title`, `ownerText`, `viewCountText`, `publishedTimeText` (relative, "13h ago"), `lengthText`. YouTube scraper: `date_posted`, `views`, `likes`, `num_comments`, `handle_name`, `subscribers`, `video_length`, `transcript`. Trustpilot `businessUnit`: `trustScore`, `stars`, `numberOfReviews`, `numberOfReviewsLast12Months`; each review has `rating` and `dates.publishedDate`. G2 JSON-LD: `ratingValue`, `reviewCount`, and `review[].datePublished` (ISO with G2's -05:00 offset and not in date order: take the max and store it as UTC).

How complete: all 21 Reddit posts had votes, comments and an exact time. The YouTube scraper returned `date_posted` and `views` on 20 of 20; `likes` was null on 9 and `num_comments` on 2.

## Sample

[`sample.json`](sample.json) has trimmed real records for "Notion AI": Reddit posts as the script prints them, one thread's comment scores, a YouTube search row and a scraper record, the Trustpilot page data and a scraper record, the G2 rating with two JSON-LD review dates, the per-day counts and two error cases. No usernames, no reviewer names. One Reddit post:

```json
{
  "id": "t3_1x90njf",
  "title": "Notion AI Voice mode",
  "subreddit": "Notion",
  "votes": 0,
  "comments": 14,
  "created": "2026-10-18T11:13:15.355Z",
  "permalink": "/r/Notion/comments/1x90njf/notion_ai_voice_mode/"
}
```

## Traps

- **Quote the brand.** Unquoted `notion ai` returned about 45 posts a day that mostly say Notion and AI separately; the quoted phrase gave 1 to 3 a day. Unquoted `windsurf` returned the sport too: about 4 of 21 posts were off-topic (r/wingfoil, r/casio).
- **Quoted search still matches the post body.** Some hits are listicles ("50 things you can sell online using AI") with no Notion AI in the title. Let a human dismiss them.
- **7 posts per page, and the cursor is sequential.** Each page carries the cursor for the next, so pages cannot run in parallel. One page took 2 to 21 s. A busy brand needs about 7 pages per day.
- **Retry the "prove your humanity" page.** Page 8 of the unquoted crawl came back 200 with 0 posts and that challenge. Ask again for the same URL.
- **The Reddit shortcuts are dead.** Plain HTML is an 8,413-byte JS shell with 0 posts (5 of 5). `search.json` is 403 plain (5 of 5) and a `reject_block` 502 through Web Unlocker after 45 to 64 s. old.reddit is a login wall. Markdown drops votes, comment counts and timestamps. Use `format: raw` and parse.
- **Drop user-profile subreddits.** Results include `u_<name>` subreddits, which are usernames. 3 of the 17 quoted posts that week sat in one (the counts above include them). The script drops them.
- **The Reddit posts scraper behaves like unquoted search.** Keyword discovery on `gd_lvz8ah06191smkebj4` took 789 s, hit its 100-post cap after 2.3 days, and only 4 of 100 contained "notion ai".
- **YouTube discovery needs no Bright Data.** Plain GET gave 20 videos in 0.94 s. The same search through Web Unlocker gave 7 videos in 33.34 s, and Unlocker markdown is an empty 790-byte footer. We sent a desktop Chrome User-Agent and `Accept-Language: en-US`.
- **`sp=CAI%253D` no longer sorts by upload date.** All 3 plain tries returned relevance order (1y, 10mo, 2y old). Use the upload-date filters `EgIIAg%253D%253D` (Today) and `EgIIAw%253D%253D` (This week). They are double-encoded on purpose.
- **YouTube counts are a floor.** The This-week filter stops at about 21 results, then continuations fall back to videos 1 month to 3 years old. The Today filter alone found 16 for the last 24 h. The number also moves: the same This-week search gave 20 videos at 19:05 UTC and 7 about an hour later (3 of 3 runs), when the Today results were mostly playlists. Show "at least N" and poll daily.
- **Relative dates shift counts by a day.** Bucketing the relative dates ("6d ago") gave 1 video for 10-12; the scraper's exact dates gave 4. Titles come back auto-translated, and only 10 of 20 This-week titles say Notion AI.
- **The YouTube keyword scraper is not a newest-first feed.** Keyword discovery on `gd_lk56epmy2i5g7lzu0k` returned 30 videos in relevance order in 379.8 s, newest 2026-10-09, so 0 in the window. With `start_date` and `end_date` it returned 1 of 20. Use plain discovery plus the by-URL scrape.
- **Trustpilot and G2 block plain fetch.** Trustpilot: 403 "Verifying Connection" from CloudFront, 3 of 3. G2: 403 DataDome captcha page, 3 of 3. Both worked 2 of 2 through Web Unlocker.
- **Trustpilot's page shows English reviews only, and `?sort=recency` changes nothing.** The Trustpilot reviews scraper (`gd_lm5zmhwd2sni130p`) found a 2026-10-14 review the page did not show (186 records, 262.66 s).
- **The G2 scraper rejects URL collection.** `gd_l88xp4k01qnhvyqlvw` answered HTTP 400 "This dataset does not support collection". G2 is Web Unlocker only, and its review cards are not in date order.
- **Reviews move too slowly to count per day.** One Trustpilot review and one G2 page-1 review fell in the 7-day window. Show rating, count and newest review date instead.
- **X is out.** Logged-out search redirects to the login flow (2 of 2), and Web Unlocker returned 26 bytes.

## Make it yours

- **Spike alerts:** compare today's Reddit count with the 7-day average and flag a jump. Every run is stored, so the history is already there.
- **Mentions under cards:** when a new Reddit title shares words with a feedback card, show it under that card as outside evidence.
- **Read the thread:** Web Unlocker raw HTML of a post permalink gives the post `score` and `comment-count`, and each `<shreddit-comment>` with `score`, `created` and `depth`, in 5.64 s (the Reddit comments scraper took 106.75 s for one thread). Skip the `author` attribute.
- **Watch a competitor:** run the same crawl for a competitor's quoted name and put both lines on one chart.
- **Every Trustpilot language:** add the Trustpilot reviews scraper as a weekly job. It found a review the English-only page did not show.
