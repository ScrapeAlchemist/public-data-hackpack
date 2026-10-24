# Radar reference

[Back to the radar guide](README.md)

API requests, config options and recorded tests for people extending the radar.
Coding agents should read this with [AGENTS.md](../AGENTS.md).

## Config options

What to watch is in [`radar.config.json`](radar.config.json). Add `"OpenAI", "ClaudeAI", "singularity"` to `subreddits` and run again. No code change. The keys: `subreddits` (`LocalLLaMA` or `r/LocalLLaMA`: letters, digits and underscore, 2 to 21 characters), `x_accounts` (`OpenAI` or `@OpenAI`, up to 15 characters), `x_days` and `x_posts_per_account` (the X scraper's date window and its `num_of_posts` per account, counted before reposts are dropped), `github_query` (GitHub search syntax, see Make it yours), `github_days`, and `github_denylist` (hides GitHub repos whose name, description or topics contain a word; lowercase). Reddit is always Top Today (`t=DAY` in the URL): the days keys apply to X and GitHub only. A pasted URL, or a name with a dot or a space, is dropped without a message; when every entry is dropped the error is "No subreddits in radar.config.json". A JSON typo in the file stops both scripts: `node radar/radar.mjs` prints the parse error, and the page stays empty while the server's terminal shows it. The server reads `radar.config.json` again at every Run, but `.env` only once, at start: after editing `.env`, stop it (Ctrl+C) and start it again.

## Why not just ask the AI?

We asked Claude Code (Opus 5.5), with only its built-in web search and fetch tools, for the same three lists: today's top 10 r/LocalLLaMA posts with scores, the 5 latest posts and follower counts of the same five X accounts, and the 10 most-starred AI or LLM repos created since 2026-10-15. Measured 2026-10-22, 46.6 s, 8 fetches:

- **Reddit: 0 of 10.** Its fetch tool cannot reach reddit.com, old.reddit.com or api.reddit.com. It returned an empty list and said so.
- **X: 0 of 5 accounts.** x.com answered HTTP 402 and two X mirror sites refused. It tried one account and stopped.
- **GitHub: 10 of 10 real repos, nothing invented.** It used GitHub's open search API, the same call this radar makes.

So the AI gets GitHub, where the API is open, up to GitHub's limit: 10 searches a minute per IP without a token, 30 with one (checked 2026-10-22). The gap is the two sources students actually scroll: Reddit and X.

## Recorded build test

On 2026-10-22, a fresh Claude Code session built the new/rising labels and
`radar/daily.mjs` from the prompt in the radar guide in 209.4 seconds (3.5 minutes),
using 29 tool calls. It changed only files under `radar/` and ran `daily.mjs` once.
This was one measured build, not a guaranteed build time.

## The route (measured 2026-10-22)

| Source | Call | Measured |
|---|---|---|
| Reddit, top today | Web Unlocker, `format: raw`, url `https://www.reddit.com/svc/shreddit/community-more-posts/top/?t=DAY&name=<subreddit>`. Parse the attributes of each `<shreddit-post ...>` tag. | One call returns the first page of Top Today. r/LocalLLaMA: 24 posts, the same 24 ids in 4 of 4 runs. r/OpenAI 24, r/ClaudeAI 24, r/singularity 20, r/MachineLearning 3. 9 calls took 3.3 to 50.5 s, median 12.9 s. In the radar: 42.4 s (the first call failed, the second worked) and 23.5 s. |
| X, latest posts per account | Web Scraper API, X posts scraper `gd_lwxkxvnf1cynvib9co`. `POST /datasets/v3/trigger?dataset_id=gd_lwxkxvnf1cynvib9co&type=discover_new&discover_by=profile_url&format=json&include_errors=true` with one input per account: `{"url": "https://x.com/<handle>", "start_date": "YYYY-MM-DD", "end_date": "<today, UTC>", "num_of_posts": 10, "include_reposts": false}`. One job for all accounts, then poll and download as in AGENTS.md. | 5 accounts, 7 days: 39 records, 0 errors, ready in 64.1 s. In the radar: 55.2 s and 75.1 s, 39 records each, 34 after dropping reposts. A 1-day window: 18 records in 56 s. |
| GitHub, new repos by stars | Plain GET, no Bright Data: `https://api.github.com/search/repositories?q=llm+created:>=<date>&sort=stars&order=desc&per_page=30` with a `User-Agent` header. | 1.0 to 1.4 s. 15,553 repos matched "llm" created since 2026-10-15; the radar keeps the top 30 by stars. |

The three run at the same time, and the X job starts first because it is the slow one. A whole run takes as long as X: 55 to 75 s in our runs. [`radar.mjs`](radar.mjs) does all of it in about 400 lines with no dependencies.

**Fields you get.** Reddit tag attributes: `id` (`t3_...`), `post-title`, `score`, `comment-count`, `created-timestamp` (exact, `2026-10-22T00:33:11.922000+0000`), `permalink`, `content-href` and `domain` (where a link post points: a model card, a repo, a video), `post-type`, `upvote-ratio`, `subreddit-name`. X records: `user_posted`, `name`, `followers`, `is_verified`, `date_posted`, `description` (the post text), `likes`, `replies`, `reposts`, `quotes`, `bookmarks`, `views`, `url`, `is_repost`, `id`. GitHub: `full_name`, `description`, `stargazers_count`, `language`, `topics`, `created_at`, `html_url`.

## Sample

[`sample.json`](sample.json) has trimmed real records from 2026-10-22: one raw `<shreddit-post>` tag, three parsed Reddit posts, one raw X record and three parsed X posts from the lab accounts, two GitHub repos, the run summary, and the two errors the radar handles. No usernames. One Reddit post:

```json
{
  "id": "t3_1xcj1wm",
  "subreddit": "LocalLLaMA",
  "title": "Qwen4 and Kimi3.1 on Arena apperantly",
  "score": 563,
  "comments": 190,
  "created": "2026-10-22T13:47:14.118Z",
  "permalink": "https://www.reddit.com/r/LocalLLaMA/comments/1xcj1wm/qwen4_and_kimi31_on_arena_apperantly/",
  "link": "https://x.com/luminabench/status/2113217029675085963?s=46",
  "domain": "x.com"
}
```

## Traps

- **Retry the "prove your humanity" page.** 1 of 9 Reddit calls came back HTTP 200 with that page, 0 posts and no `x-brd-error-code`. A later call for the same URL worked. Check for 0 posts, not just the status. The radar asks up to 3 times.
- **Skip the ads.** Each page holds 1 to 5 `<shreddit-ad-post>` tags. Match `<shreddit-post` followed by a space, so the ads never match.
- **Never read the author.** The tag carries `author` and `author-id`. The radar does not parse them, and you do not need them.
- **Scores are Reddit's displayed score.** Reddit fuzzes votes, so the same post shows a slightly different score on each load (663, then 674 twenty minutes later). Say "displayed score", and compare big moves, not single points.
- **Pinned posts sit in the list.** r/ClaudeAI's top list included its pinned megathread, and no attribute marks it. Drop it by title if it bothers you.
- **Quiet subreddits return few posts.** r/MachineLearning had 3 in Top Today.
- **The other Reddit routes are dead.** The plain page is a JS challenge with 0 posts. `top.json` is 403. old.reddit is 403 plain and a login wall through Web Unlocker. The full www page through Web Unlocker gave 3 posts in 39 s. Use the `/svc/shreddit/` URL above.
- **`include_reposts: false` is not honored.** 5 of 39 X records were reposts. Drop records with `is_repost: true`.
- **`num_of_posts` is per account.** With 10, a busy account gives 10 and a quiet one fewer: after dropping reposts, 10, 9, 6, 5 and 4 posts in our 7-day run.
- **`end_date` today is fine.** With `end_date` set to today's UTC date, the job returned posts from earlier that day.
- **Do not use the X profile scraper for "latest".** The sync profile scraper (`gd_lwxmeb2u1cniijd7t4`) returned old, most-liked posts for @MistralAI and @huggingface, not their latest. Use the posts scraper with a date window.
- **X takes about a minute.** Start it first and show the other two while it runs. The page does this.
- **GitHub counts its search limit per IP address without a token.** 10 searches a minute per IP, 30 with a token (checked 2026-10-22), and each radar run makes one. A room on one Wi-Fi shares the 10. Put a GitHub personal access token in `.env` as `GITHUB_TOKEN` and the radar sends it. GitHub also wants a `User-Agent` header; the radar sends one.
- **Top by stars is not all safe for a projector.** On 2026-10-22 the top 10 held a jailbreak repo, a "stealth bridge" repo and a repo listing third-party API relay sites, two of them with Chinese descriptions. The denylist in `radar.config.json` hides all three. Edit it.

## Make it yours

- **Scale it:** the prompt in [the radar guide](README.md#paste-this-into-your-agent-scale-it). Four subreddits, "new" and "rising" tags, and a daily script. Then schedule it: [Take it home](README.md#take-it-home-a-daily-monitor).
- **Your own corner of AI:** swap the accounts and subreddits for robotics, bio or game dev, and change `github_query`. All of it is in `radar.config.json`, no code change. Each subreddit is one Web Unlocker call per run, and the calls run in parallel; all X accounts go into one Web Scraper job. A quiet subreddit returns few posts (r/MachineLearning: 3 in Top Today), so check a new one with `node radar/radar.mjs --only reddit` before you keep it.
- **More X accounts:** add handles to `x_accounts` (`OpenAI` or `@OpenAI`). All of them go into one Web Scraper API job; five accounts took 55 to 75 s. The radar waits 240 s for the job, then marks X failed with the snapshot id in the error. The job still finishes on Bright Data's side: download it by hand with `GET /datasets/v3/snapshot/<id>?format=json` (AGENTS.md, call 3), or raise the cap in `fetchX`. The page shows the top 3 posts per account by likes (`topPerAccount(..., 3)` in `public/index.html`) whatever `x_posts_per_account` says, and its X column title says "AI lab accounts": edit both there when you watch something else. Every post is in the saved run file.
- **Wider GitHub search:** `github_query` takes GitHub's search syntax and the radar URL-encodes it; it adds `created:>=<date>` from `github_days` itself, so do not write your own `created:`. Checked 2026-10-23 with the radar's URL and no token: `llm OR agents` (63,529 repos created since 2026-10-16, 0.5 s), `topic:llm` (5,021) and `language:python llm` (8,890) all returned HTTP 200. The same forms fit any field (`robotics OR ros2`, `topic:bioinformatics`; not run here). The radar keeps the top 30 by stars, so a wider query changes which 30 you see, not how many.
- **A fourth source:** add a `fetchYourSource()` to `radar.mjs` in the shape of `fetchGitHub` (returns an object with `seconds` and a list of items, throws on failure), put its name in `SOURCES`, its call in the `jobs` map of `runRadar`, any new config key in `loadConfig` (it returns a fixed set of keys) and a block in `printRun` if you want it on the command line. Then the page, `public/index.html`: a fourth `<section>`, a `ROWS` entry, the name in its own `SOURCES` list, a title in `titles()`, and `repeat(3, ...)` in the grid CSS becomes 4. `server.mjs` needs no change: it reads `SOURCES` from `radar.mjs`. Try a plain `fetch` first, as GitHub does; if the site blocks, go through Web Unlocker as Reddit does (`redditTop` in `radar.mjs` is the pattern). Hacker News, Hugging Face and blog RSS feeds are the usual next picks; none of them is measured here.
- **Is the launch real?** When a lab posts a name on X, look for the same name in Reddit titles and GitHub repos from the same run. All three are already in one saved file.
- **Read the thread:** Web Unlocker raw HTML of a post's permalink gives the post's `score` and `comment-count` and each `<shreddit-comment>` with `score`, `created` and `depth` (measured 5.64 s, see card 07). Skip the `author` attribute.
- **A trend line:** every run is saved. Chart a repo's stars or a post's score across runs.
