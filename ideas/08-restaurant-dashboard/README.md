# 08. A restaurant dashboard that watches the block

**The app people already build:** a dashboard for a restaurant owner. Menu items, daily sales typed in by hand, the staff schedule. It works with no public data at all.

**What public data adds:** every competitor in your Yelp category within a mile, with the exact star rating and the exact review count, refreshed weekly. Compare the weekly runs and the dashboard can flag new openings (a listing with 0 reviews and no rating), rating drops, and who is gaining reviews fastest.

| Without public data | With public data |
|---|---|
| You know your own numbers and nothing about the block | 10 ramen competitors within 1 mile of 2400 Telegraph Ave, Berkeley, each with exact rating and review count |
| You hear about a new place when its line forms | A new listing shows up in the weekly run with `reviewCount` 0 and `rating` null |
| "They seem busy lately" | Review count and rating per competitor, week over week |

## Why not just ask the AI?

We gave Claude Code its own web search and fetch tools and asked for every Ramen-category business on Yelp within 1 mile of 2400 Telegraph Ave, with rating, exact review count and price. Measured 2026-10-19:

- **Finding the places: the AI did well.** It named 7 of the 10 real competitors in 67.9 s, with no wrong values. One of them, Masa Ramen Bistro, is a place Yelp's own Walking (1 mi.) filter misses.
- **The numbers: 0 of 21.** Every rating, review count and price came back null, because all 4 of its Yelp fetches got HTTP 403. Score: 19 of 60 fields exact. It also missed DH Noodles And Grill, Party Sushi and Kinda Izakaya.
- **One named listing works.** In a separate run, given Bansho Ramen's Yelp URL, it returned the right rating (4.1) and count (196) in 34.6 s, even with every Yelp fetch blocked.

So the AI can tell you who is on the block. The scraper wins on the numbers the dashboard tracks: exact rating and count for every competitor, every week, without anyone waiting.

## Paste this into your agent

Open Claude Code or Cursor in this repo, then:

```
Read AGENTS.md and ideas/08-restaurant-dashboard/README.md first.

Build a restaurant owner's dashboard in apps/block-watch/ (Node 20+, built-in fetch and
node:http, plain HTML/JS, JSON files for storage, no npm install):
1. Owner pages, typed in by hand: menu items with prices, daily sales, staff schedule.
   Save each to its own JSON file in apps/block-watch/data/.
2. Settings: the restaurant's address and its Yelp category alias (for example ramen).
3. A "Scan the block" button. It starts a background job and returns right away; the page
   polls and shows "scanning..." (a scan takes a minute or more). The job calls
   findCompetitors(address, alias, 1) from ideas/08-restaurant-dashboard/yelp_competitors.mjs
   and appends the result, with its fetched_at, to data/scans.json. Never call Yelp on page load.
4. A Competitors page: name, rating, review_count, price, dist_mi and the change since the
   previous scan. Tag a biz_id that was not in the last scan, or has review_count 0 and
   rating null, as "new"; a lower rating as "dropped"; alert "tempclosed" as "closed for now".
   Sort by reviews gained since the last scan.
5. apps/block-watch/refresh.mjs runs the same job from the command line, for a weekly cron.
6. The Bright Data key stays on the server. Never print it or send it to the browser.
Test once with "2400 Telegraph Ave, Berkeley, CA" and ramen (8 Yelp pages, about 10
competitors), then reuse data/scans.json while you work on the UI.
```

Building into an app you already have? Copy `AGENTS.md` and this folder into it and point step 3 at your code.

## The route (measured 2026-10-19)

| Step | Call | Measured |
|---|---|---|
| 1. Read Yelp's distance boxes | Web Unlocker, `format: raw`: `https://www.yelp.com/search?cflt=<alias>&find_loc=<address>`. In the `data-hypernova-key` script, the radio inputs named `l` hold `Walking (1 mi.)`, `Biking (2 mi.)` and others, each a `g:minLng,minLat,maxLng,maxLat` box. Cache them per address. | Search pages: 15 of 15 OK, 14.2 to 34.5 s, median 18.6 s. The boxes were identical on every search page for the address. |
| 2. Search the category in two boxes | Same call plus `&l=<box>`, and `&start=10`, `20`, ... while below `totalResults`. Walking box and Biking box in parallel, at most 6 requests at once. Parse `Business:<bizId>` from the `data-apollo-state` script. | Walking box: 8 results, 1 page, 34.11 s. Biking box: 12 results, 2 pages, 34.5 s. |
| 3. Check distance for the rest | Web Unlocker, raw: `https://www.yelp.com/biz/<slug>` for each Biking-box result that is not in the Walking box. Read lat,lng from the map image `src` (`center=`). Keep it if the haversine distance from the box center is 1 mile or less. Cache by biz_id. | 4 biz pages, 13.4 to 39.8 s each. Kept 2 (0.799 and 0.809 mi), dropped 2 (1.052 and 1.407 mi). |
| 4. Diff against last week | Compare the `biz_id` set, `rating` and `review_count` with the previous stored scan. | The full 1-mile set took about 74 s. Two later end-to-end runs of `yelp_competitors.mjs` took 112 s (8 calls) and 159.1 s (11 calls, 3 of them retries). Two fetches 5.5 min apart returned the same 10 biz_ids in the same order with 0 field changes. Over weeks: not measured. |

Request shapes are in [AGENTS.md](../../AGENTS.md). [`yelp_competitors.mjs`](yelp_competitors.mjs) does all four steps with no dependencies and caches boxes and coordinates in `cache/yelp_coords.json`:

```
node ideas/08-restaurant-dashboard/yelp_competitors.mjs "2400 Telegraph Ave, Berkeley, CA" ramen 1
```

It returns `{address, category, miles, fetched_at, center, boxes, competitors: [{biz_id, slug, name, rating, review_count, price, categories, address, alert, lat, lng, dist_mi, url}], outside_radius, unchecked, bd_calls}`. `center` is the point `dist_mi` is measured from, `boxes` names the two Yelp boxes searched, and `bd_calls` counts this scan's Web Unlocker calls, retries included. `price` is `''` when Yelp shows no price level. Rows inside the Walking box keep `dist_mi` null (they are in range by geometry); add `--all-coords` to fetch a biz page for each of them too. For other radii it picks the boxes the same way (the biggest box that fits inside the circle, the smallest that holds it). Only 1 mile was measured.

**Fields you get.** Search page, per business: `encid` (the biz_id, 22 characters), `alias` (the slug), `name`, `rating`, `reviewCount` (exact), `priceRange.display` (`$` to `$$$$`), `categories[].title`, `location.address.addressLine1`, `city`, `neighborhoods`, and `activeAlert`. The biz page adds lat,lng, `claimability({"useConsumerClaimability":true}).isClaimed`, `isClosed`, `closedUntil`, hours per weekday, `isYelpAdvertiser`, postal code, `history.yearEstablished` (null for Bansho) and `searchStats`.

How complete: a full search page held 10 organic rows plus 1 to 8 ads, and all 54 rows of the longest search (6 pages) resolved to a `Business` entry. Across 69 slugs seen in all runs, no slug mapped to two biz_ids.

## Sample

[`sample.json`](sample.json) has the trimmed source structures with Yelp's own field names (the distance boxes, organic and ad rows, Apollo `Business` entries for a temporarily closed place and a new one, a biz page entry) and the script's output. One competitor:

```json
{
  "biz_id": "t_flm6D8DvgrXpnrlv8_Fw",
  "slug": "masa-ramen-bistro-berkeley-3",
  "name": "Masa Ramen Bistro",
  "rating": 4.5,
  "review_count": 320,
  "price": "$$",
  "categories": ["Hawaiian", "Ramen", "Japanese Curry"],
  "address": "1923 University Ave",
  "alert": "tempclosed",
  "lat": 37.871817,
  "lng": -122.272384,
  "dist_mi": 0.809
}
```

## Traps

- **Plain fetch is blocked outright.** Python requests got HTTP 403 from DataDome on 11 of 11 Yelp search and biz URLs (a 776 to 951 byte captcha page), and Claude WebFetch got 403 on 8 of 8. There is no plain-fetch shortcut here.
- **Markdown rounds the counts.** With `data_format: markdown` review counts come back as "2.3k". Use `format: raw` and read `reviewCount` from `data-apollo-state`, which is HTML-escaped JSON inside `<!-- -->`.
- **`find_desc` is a relevance search, not a category.** `find_desc=ramen` in the Walking box returned 54 results and only 8 had the Ramen category (the rest included Thai, donut shops, a drugstore and a convenience store). `cflt=ramen` in the same box returned 8, all Ramen.
- **An address alone does not limit distance.** With no `l=`, the search returned 187 results reaching Oakland, El Cerrito and Emeryville, even though the page marks "Within 4 blocks" as selected.
- **"Walking (1 mi.)" is a box, not a radius.** It is about 1.4 x 1.4 mi and missed Masa Ramen Bistro (0.809 mi) and Kinda Izakaya (0.799 mi). Search the Biking (2 mi.) box and check the distance yourself.
- **Search pages carry no coordinates.** lat,lng come only from the biz page's map `src`, one 13 to 40 s fetch per business. Cache them by biz_id; restaurants do not move.
- **Organic rows hold only an id.** Each organic result is `{bizId, searchResultBusiness: null}`; resolve it as `Business:<bizId>` in the Apollo state. Ads carry `isAd: true`: drop them. A competitor can also be an ad (Bansho was).
- **Never send `open_now=1`.** It got `page_block`, then `dd_hardblock_after_solve`, 0 bytes. `open_now=true` is silently ignored. Read hours from the biz page.
- **`isClosed` misses temporary closures.** Masa Ramen Bistro had `isClosed: false` and `closedUntil: "2027-01-01"` while its page said "Temporarily closed". Its search entry carried `activeAlert` type `tempclosed`.
- **New places have nulls.** Tora Ramen came back with `rating: null` and `reviewCount: 0`. Do not show that as 0 stars: it is your new-opening signal. Yelp shows no price level for many places (HINODEYA, DH Noodles, Sobo, Kinda Izakaya), so show "none", not "$".
- **Skip the Yelp businesses scraper** (`gd_lgugwl0519h1p14rwk`). It returned 0 usable records for 3 inputs in 2 runs (one empty record, then `detect_block`), taking 196 to 377 s each. Web Unlocker raw pages are the route.

## Make it yours

- **Monday digest:** after the weekly scan, send the owner new openings, rating drops, temporary closures and the top 3 by reviews gained.
- **Price position:** count the competitors at each `price` level and show where the owner's menu sits.
- **Hours gaps:** fetch the biz pages once (`--all-coords`), keep the hours per weekday, and show when nobody nearby is open. Bansho Ramen, for one, is closed on Mondays.
- **More than one category:** run it for each category alias you compete in and merge by biz_id. Check that every row carries the category you asked for.
