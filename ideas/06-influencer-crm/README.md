# 06. An influencer CRM with exact followers

**The app people already build:** a CRM for creator partnerships. Creators, outreach status, deal terms, deliverables, due dates. It works with no public data at all: you type in the follower count yourself.

**What public data adds:** every creator row gets their exact follower count, the engagement rate on their last 12 posts and how often they post, refreshed weekly. National Geographic has 268,337,664 Instagram followers and 0.026% engagement on its last 12 posts. Veritasium's Instagram engagement is 5.71%, but its last post there was on 2025-12-02.

| Without public data | With public data |
|---|---|
| A rounded follower count, typed in ("5.2M" on mkbhd's Instagram page) | Exact followers from the profile (5,287,693), refreshed weekly |
| No idea if the audience still reacts | Engagement rate from exact likes and comments on the last 12 posts |
| You find out a creator went quiet after the contract is signed | Posts per week and last post date on every row |

## Why not just ask the AI?

We asked Claude Code, with only its built-in web search and fetch tools, for 5 creators on Instagram and the same 5 on YouTube: followers, posts in the last 30 days, average likes on the last 12 posts, average views, latest post date. Measured 2026-10-19: 24 of 45 fields exact, in 140.8 s.

- **YouTube: the AI did fine.** 18 of 25 fields exact, 0 wrong. It found each channel's public RSS feed and matched it within 0.1%. It returned no subscriber counts (null for all 5), and no 30-day count for NatGeo and NASA because the feed stops at 15 uploads.
- **Instagram: 6 of 20 exact.** All 5 follower counts were rounded page values (5,200,000 vs 5,287,693 for mkbhd). Average likes were null for all 5: the logged-out page shows no like counts. Posts in the last 30 days were null for MrBeast, NatGeo and NASA, and Veritasium's latest post date was a day off (UTC, see Traps).
- **Definitions drift:** its YouTube "last 12" mixed Shorts with long-form videos. MrBeast came out at 97.5M average views; long-form only is 131.9M.

So for YouTube uploads, skip Bright Data and read the RSS feed (step 5 below). The scrapers win on Instagram, where plain requests and the AI both come back with no exact followers and no likes, and on refreshing a whole roster in one background job.

## Paste this into your agent

Open Claude Code or Cursor in this repo, then:

```
Read AGENTS.md and ideas/06-influencer-crm/README.md first.

Build a creator-partnership CRM in apps/creator-crm/ (Node 20+, no npm install: node:http,
built-in fetch, plain HTML/JS, JSON files in apps/creator-crm/data/):
1. Creators table: name, Instagram handle, YouTube handle, outreach status, deal terms,
   deliverables with due dates. Add, edit, delete in the browser. This must work with no API key.
2. A "Refresh numbers" button starts a background job and returns at once. Rows show
   "refreshing..." and the page polls. Never block a page load on a Bright Data call.
3. The job follows "The route" in the card. Instagram: one profiles call and one posts
   discovery (num_of_posts 30) for all handles, run in parallel (about 2 to 3 minutes; a
   zero-post retry adds another 2 to 3). Sort posts by date_posted, take up to 12, compute
   engagement rate and posts per week exactly as the card says. Followers come from the
   profiles scraper only.
4. YouTube: get the channel id and subscribers once from the channels scraper, then read the
   plain RSS feed (no Bright Data) for average views and likes on the newest 12 uploads.
5. Count posts per handle and retry handles with 0 once. Skip records with error_code.
6. Append every run to data/snapshots.json with fetched_at. Each row shows followers,
   engagement %, posts per week, last post date, change since the last run, and fetched_at.
7. Add apps/creator-crm/refresh.mjs that runs the same job from the command line, so a
   weekly scheduler can call it.
Keep the API key on the server and never print it. Test with Instagram mkbhd and natgeo and
YouTube @mkbhd (3 Bright Data jobs, 4 if a handle needs the retry), and check field names
against ideas/06-influencer-crm/sample.json.
```

Adding this to a CRM you already have? Copy `AGENTS.md` and this folder into your project and point the prompt at your code.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Instagram profile | Web Scraper API, Instagram Profiles scraper, `gd_l1vikfch901nx3by4`. Input `{"url": "https://www.instagram.com/<handle>/"}`, every creator in one call. | 13 of 13 with exact `followers`, 0 errors. 3 profiles: 180.7 s. 10 profiles: 110.8 s. The sync call answered 202 after about 61 s, then poll the snapshot. |
| 2. Instagram posts | Instagram Posts scraper, `gd_lk5ns7kz21pck8jpis`, trigger with `type=discover_new&discover_by=url`. Input `{"url": "https://www.instagram.com/<handle>/", "num_of_posts": 30}` per creator. | 100.8 to 139.0 s per job. 4 creators x 30 = 120 records in 139.0 s. Exact `likes`, `num_comments`, `date_posted`. |
| 3. Engagement | Sort by `date_posted`, newest first, keep up to 12; n = the number kept. Rate = 100 x (sum of `likes` + sum of `num_comments`) / n / `followers` from step 1. Posts per week = 7 x (n - 1) / days, where days = whole calendar days between the UTC dates (date part of `date_posted`) of the oldest and newest of the n kept posts, minimum 1. Leave posts per week empty when n < 2. | Rate: mkbhd 3.96%, Veritasium 5.71%, MrBeast 1.82%, NASA 0.43%, NatGeo 0.026%. Posts per week: NatGeo 25.67, MrBeast 2.66, mkbhd 0.66, Veritasium 0.04. |
| 4. YouTube channel (once per creator) | YouTube Channels scraper, `gd_lk538t2k2p1k3oos71`. Input `{"url": "https://www.youtube.com/@<handle>/about"}`. Sync. | 13 of 13. 3 channels: 19.6 s. 10 channels: 37.5 s. Save `id` (the `UC...` channel id). `subscribers` is rounded (21400000). |
| 5. YouTube uploads, no Bright Data | Plain `GET https://www.youtube.com/feeds/videos.xml?channel_id=<id>` | 7 of 7 OK in 0.20 to 0.50 s. The 15 newest uploads with exact views, likes and publish time. |
| 6. X profile (optional) | X Profiles scraper, `gd_lwxmeb2u1cniijd7t4`. Input `{"url": "https://x.com/<handle>", "max_number_of_posts": 10}`. Sync. | One run: 4.46 s. Exact followers (NASA: 92,321,193) and 10 posts with likes, replies, reposts, views. |
| 7. YouTube history (optional) | YouTube Videos scraper, `gd_lk56epmy2i5g7lzu0k`, `discover_by=url`. Input `{"url": "https://www.youtube.com/@<handle>/videos", "num_of_posts": 15}` | 209.8 to 264.7 s. Long-form only. NatGeo with `num_of_posts` 40: 38 videos plus 2 error records in 248.6 s. |

Request shapes, polling and error handling are in [AGENTS.md](../../AGENTS.md). Run steps 1 and 2 in parallel and join on the handle: `account` in the profile, the handle in `discovery_input.url` on each post.

In the RSS feed, each `<entry>` has `<yt:videoId>`, `<published>`, views in `<media:statistics views="...">` and likes in `<media:starRating count="...">`.

**Fields you get.** Instagram profile: `account`, `full_name`, `followers` (exact), `following`, `posts_count`, `is_verified`, `biography`, `external_urls`, and `posts[]`, the 12 grid posts with `caption`, `datetime` (date only), `content_type` and `url`. Instagram post: `url`, `shortcode`, `user_posted`, `date_posted` (UTC), `content_type` (Reel, Image, Carousel), `likes`, `num_comments`, `description`, `coauthor_producers`. YouTube channel: `id`, `handle`, `subscribers`, `videos_count`, `views` (channel total, exact), `created_date`. YouTube video (step 7): `views`, `likes`, `num_comments`, `date_posted`, `video_length`, `title`, `transcript`. X: `followers`, `following`, `posts_count`, `date_joined`, and `posts[]` with `likes`, `replies`, `reposts`, `views`, `date_posted`.

How complete: for all 5 test creators, every post in the newest 12 had `likes`. In the profile records, 0 of 156 grid posts had likes or comments.

## Sample

[`sample.json`](sample.json) has trimmed real records from every step (famous creators, brands and NASA only), with field names exactly as each source returns them, the computed engagement rows, and one error record. One Instagram post:

```json
{
  "url": "https://www.instagram.com/reel/Dero7QJsruR/",
  "user_posted": "mrbeast",
  "date_posted": "2026-10-19T16:03:20.000Z",
  "content_type": "Reel",
  "likes": 133957,
  "num_comments": 7474,
  "followers": 91000000,
  "discovery_input": { "url": "https://www.instagram.com/mrbeast/", "num_of_posts": 30 }
}
```

Note `followers` here: 91000000. The profiles scraper said 91087802 in the same run.

## Traps

- **A 200 from Instagram is not data.** Plain requests from a home IP got HTTP 200 on 5 of 5 profile fetches, but each was a ~588 KB shell page with no profile data and no follower count. The public `web_profile_info` JSON endpoint returned 429 on 5 of 5. Check for a follower count, not the status code.
- **Web Unlocker markdown is not enough here.** Instagram markdown gave rounded followers ("5.2M followers") and no likes. YouTube `/videos` markdown was 818 to 821 bytes of footer links.
- **YouTube and X pages load plain, with rounded numbers.** The YouTube `/videos` page answered in 0.32 to 0.55 s on 5 of 5, with "21.4M subscribers", views like "10M" and dates like "2d ago". The X page answered 3 of 3 with "92.3M" followers and 5 posts with rounded counts. Use the RSS feed for exact YouTube numbers and the X scraper for exact X followers.
- **The profiles scraper has no likes.** Engagement needs the posts scraper (step 2), joined on the handle.
- **Pinned posts come first.** A 12-post pull for MrBeast held 3 pinned old posts (2024-11-28, 2026-06-14, 2026-07-21) and pushed average likes to 4.03M, against 1.62M on the true newest 12. Pull 30, sort by `date_posted`, take 12. There is no pinned flag.
- **Collab posts carry another account's numbers.** 2 of mkbhd's newest 12 and 4 of NASA's were posted by another account. On those, `user_posted`, `followers` and `posts_count` belong to that account (325000 on one of mkbhd's). Our rates kept these posts; filter on `user_posted` if you want only the creator's own.
- **Post records round followers.** Even on the creator's own posts, `followers` is rounded (91000000 for MrBeast). Take followers from step 1 only.
- **Silent empty input.** In a 5-creator posts job, veritasium came back with 0 records and no error record. The rerun returned 30. It happened again in a later test run: mkbhd came back with 0 in a 2-handle job and the retry returned 30, for 284 s in all. Count records per input and retry the zeros once.
- **Records come back unsorted** from both the Instagram posts and YouTube videos scrapers. Sort before you take 12.
- **YouTube subscribers are rounded everywhere.** 3 significant figures in the scraper (21400000) and on every public page. No route we tried gave an exact count. Label it as rounded.
- **Shorts change the YouTube numbers.** The RSS feed includes Shorts and lives; step 7 reads the `/videos` tab, long-form only. 8 of MrBeast's 15 feed entries and 14 of NASA's were not on the `/videos` tab. Pick one definition and show it on the page.
- **The feed stops at 15.** For NatGeo and NASA all 15 entries fell inside 30 days, so the feed cannot count a month for busy channels. Step 7 with `num_of_posts` 40 found 28 NatGeo long-form videos in 30 days.
- **Errors arrive inside a 200.** NatGeo's 40-video job returned 2 `dead_page` records. Also skip videos with 0 views (upcoming livestreams) when you average.
- **Reposts on X show 0 likes.** Their `description` starts with "RT @". Leave them out of engagement.
- **Dates are UTC.** Instagram `date_posted` is UTC and the page shows local dates, so a post can be a day off (Veritasium: 2025-12-02 in the scraper, 2025-12-01 from the page).
- **It is slow.** Instagram jobs took 100.8 to 180.7 s, YouTube discovery 209.8 to 264.7 s. Refresh in the background or on a schedule, never on a click.

## Make it yours

- **Weekly growth:** compare `followers` across snapshots and show the change next to the deal. A creator who loses followers mid-campaign is worth a call.
- **Dormant flag:** mark creators with no post in 30 days. Veritasium's Instagram would be flagged (0 posts, last on 2025-12-02) while its YouTube put out 3 long-form videos in the same 30 days.
- **Deliverable check:** after a due date, look in the latest pull for a post whose `description` names the brand or whose `coauthor_producers` is set. Link it on the deliverable and track its likes while it stays in the newest 30.
- **Fee check:** divide the creator's quoted fee by average likes or views on the last 12 and sort the pipeline by it.
- **Add X:** one sync call per profile gives exact followers and views on the last 10 posts.
