# 05. A store admin that watches competitor prices

**The app people already build:** the admin page of a small online store. Your catalog, your prices, your stock. It works with no public data at all: you set prices by hand and hope they are still right.

**What public data adds:** for each product you sell, the same product's price at Amazon, Walmart and Target, every day. Matched by GTIN/UPC where the stores agree, pinned by hand once where they do not. You get an alert when a competitor's new-condition price goes below yours, and a price history per product and store.

| Without public data | With public data |
|---|---|
| You check competitor prices by hand, when you remember | A daily job reads Amazon, Walmart and Target for every product |
| You learn you were undercut when sales drop | An alert the day a new-condition offer goes below your price |
| One number, today | A history per product and store, with seller and stock |

## Why not just ask the AI?

We gave Claude Code its own web search and fetch tools and asked for 15 prices: 5 well-known products (Anker 737 power bank, Hydro Flask 32 oz, Logitech MX Master 3S, AirPods Pro 2, Instant Pot Duo 6 qt) at Amazon, Walmart and Target, new condition only. Measured 2026-10-19:

- **1 of 15 prices, in 177.8 s.** The one it got (MX Master 3S at Target, 109.99) matched the scraper exactly. It named a different seller than the scraper did; we did not resolve which is right.
- **Target: the AI did fine.** Besides that price, it reported no exact Target listing for the other 4 products, the same conclusion we reached by title.
- **It made nothing up.** Every empty cell came back null with a reason.
- **Amazon and Walmart: 0 of 10, even with the exact URLs.** Given the 10 product pages, it returned 0 prices in 82.8 s. Walmart showed it "Robot or human?" on every fetch, and Amazon pages loaded with no buy-box price. In the same window the scrapers read 10 of 10 (2 of them not new, see Traps).
- **Its fetcher is what gets blocked.** A plain script from a home IP in Israel read a price from 4 of 5 Amazon pages (the miss was the used buy box) and 5 of 5 Walmart pages in the same window.

So for "does Target sell this at all?", the AI alone is enough. The scraper wins on Amazon and Walmart prices, the condition behind each price, and checking every product every day without anyone waiting.

## Paste this into your agent

Open Claude Code or Cursor in this repo, then:

```
Read AGENTS.md and ideas/05-price-watch/README.md first.

Build a small store admin with a competitor price watch in apps/price-watch/ (Node 20+, no npm
install: built-in fetch, node:http, plain HTML/JS, JSON files in apps/price-watch/data/).
1. data/catalog.json: my products with name, gtin, our_price, stock, one pinned id per store
   (amazon_asin, walmart_id, target_tcin; null when the store does not sell it) and
   confirmed_upcs per store (UPCs a human accepted for that pin, empty at first). Seed two:
   Instant Pot Duo 6 qt: gtin 810028585201, ASIN B00FLYWNYQ, Walmart 575389962, Target null.
   Logitech MX Master 3S: gtin 097855174819, ASIN B0FB21526X, Walmart 731473988, Target 1008322060.
   Its Amazon and Target pins carry other UPCs, so they show "check variant" on the first run.
   Pick our_price so at least one price in ideas/05-price-watch/sample.json is below it.
2. Admin page: the catalog table with editable price and stock. It works with no Bright Data key.
3. collect.mjs runs the card's route: one Amazon, one Walmart and one Target scraper job, each
   with all its URLs, through the sync endpoint. Any of them can answer 202: then poll progress
   and download. Skip records with error or
   error_code. Append one row per product and store to data/prices.jsonl: price, list_price,
   condition, is_new, seller, in_stock, the store's upc/gtin, url, fetched_at.
4. Set is_new as the Traps say (Amazon variant_condition, null: see Traps; Walmart "Restored" in
   product_name or conditionGroupCode=2 in url). Flag a row "check variant" only when its
   upc/gtin is neither our gtin nor in that store's confirmed_upcs. A "Confirm" button on the
   row adds its upc to confirmed_upcs.
5. A "Check prices" button starts collect.mjs as a background job and returns at once. The page
   shows progress (about 1.5 to 3 minutes). Never call Bright Data on a page load.
6. refresh.mjs runs one collection and exits, for cron. After each run write data/alerts.json:
   a new-condition competitor price below our_price. A missing price is "no data", not a change.
7. Product page: latest price per store with seller, source URL and fetched_at, plus a price
   history chart (inline SVG) from prices.jsonl.
Test on the 2 seeded products only (3 scraper jobs). Never print the API key.
```

Already have a store admin? Copy `AGENTS.md` and this folder into your project and point step 2 at your own catalog.

## The route (measured 2026-10-19)

Pin the ids once, then run one batch a day.

| Step | Call | Measured |
|---|---|---|
| 1. Pin one id per store, once | Amazon child ASIN, Walmart `usItemId`, Target TCIN. Find candidates on each store's search page, then confirm with the scraped record's identifiers (Amazon `upc`, Walmart `gtin`, Target `upc`) and one human look. | Plain fetch: Walmart search `__NEXT_DATA__` held 41 to 51 items with `usItemId`; Amazon search showed 18 to 58 cards. Target search showed TCINs only through Web Unlocker markdown (71 to 103 s). |
| 2. Amazon prices, daily | Web Scraper API, Amazon products scraper, `gd_l7q7dkf244hwjntr0`, input `{"url": "https://www.amazon.com/dp/<ASIN>"}`, all ASINs in one sync call | 5 ASINs in 10.76 s, sync 200, 5 of 5 records, 0 errors. The buy box was new on 4 of 5. |
| 3. Walmart prices, daily | Walmart products scraper, `gd_l95fol7l1ru6rlo116`, input `{"url": "https://www.walmart.com/ip/<usItemId>"}` | 5 URLs: 202 at 60.79 s, ready at 163.93 s, downloaded at 164.88 s. 5 of 5 records, 4 of 5 really new. |
| 4. Target prices, daily | Target scraper, `gd_ltppk5mx2lp0v1k0vo`, input `{"url": "https://www.target.com/p/-/A-<TCIN>"}` | 4 URLs: 202 at 61.13 s, ready at 131.83 s, 4 of 4 records. 1 was the exact SKU, 1 was out of stock with no price. |
| 5. Other sellers (optional, weekly) | Google Shopping through a `serp` zone: `POST /request` with `https://www.google.com/search?q=<product>&udm=28&hl=en&gl=us&uule=<location>&brd_json=1`. Tiles are in `shopping[]`, not `organic[]`. | 10 of 10 on the first attempt, 4 to 17 s, 40 tiles per query, 7 to 36 shops. 0 Amazon and 0 Walmart tiles. Measured with a `serp` zone only. AGENTS.md shows `unblocker` and `serp` returning the same organic JSON; Google Shopping (`udm=28`) through an `unblocker` zone was not measured. |

Request shapes are in [AGENTS.md](../../AGENTS.md). Steps 3 and 4 used the sync `/datasets/v3/scrape` endpoint, got a 202 with a `snapshot_id` after about 61 s, then polled `/datasets/v3/progress/<snapshot_id>` every 5 s and downloaded the snapshot. That is a batch job, not something a click waits on. Which store answers 202 changes from run to run: in a later test run (2 products) Walmart answered 200 in 30 s while Amazon and Target answered 202, and the whole collection took 97 s. Handle both answers for every store.

**Fields you get.** Amazon: `asin`, `parent_asin`, `title`, `final_price`, `initial_price`, `discount`, `currency`, `variant_condition`, `buybox_seller`, `availability`, `is_available`, `other_sellers_prices[]` (`price`, `seller_name`, `condition`, `ships_from`), `upc`, `model_number`, `variant_attributes`, `rating`, `reviews_count`, `zipcode`, `timestamp`. Walmart: `product_id` (the usItemId), `product_name`, `final_price`, `initial_price`, `condition`, `seller`, `availability_text`, `is_available`, `gtin`, `upc`, `rating`, `reviews_count`, `store_name`, `timestamp`. Target: `tcin_id`, `title`, `final_price`, `initial_price`, `price_range`, `seller_name`, `availability_text`, `is_available`, `upc`, `rating`, `reviews_count`, `zipcode`, `timestamp`. Google Shopping tile: `title`, `price` (a string like "$23.90"), `old_price`, `shop`, `tag`, `shipping`, `rating`, `reviews_cnt`, `rank`, `link` (holds `headlineOfferDocid`).

How complete: on this run a price came back for Amazon 5 of 5 (one was a used buy box), Walmart 5 of 5 (one was Restored) and Target 3 of 4 (one out of stock). The dataset metadata lists 120 fields for Amazon, 104 for Walmart and 70 for Target.

## Sample

[`sample.json`](sample.json) has trimmed real records (products and shops only), with field names exactly as each source returns them: 2 Amazon, 2 Walmart, 2 Target records and 2 Google Shopping tiles. The same Instant Pot at two stores, matched by UPC:

```json
[
  {
    "asin": "B00FLYWNYQ",
    "title": "Instant Pot Duo 6 Qt 7-in-1 Electric Pressure Cooker, Stainless Steel",
    "final_price": 79,
    "initial_price": 109.99,
    "variant_condition": "Buy New",
    "buybox_seller": "Amazon.com",
    "upc": "810028585201",
    "zipcode": "11001",
    "timestamp": "2026-10-19T19:08:12.871Z"
  },
  {
    "product_id": "575389962",
    "product_name": "Instant Pot 6Qt DUO 7-in-1 Multi-Cooker, Pressure Cook, Slow Cook, & more, Stainless Steel",
    "final_price": 131.99,
    "initial_price": 149.99,
    "condition": "New",
    "seller": "ZAI XPRESS L.L.C.",
    "gtin": "810028585201",
    "timestamp": "2026-10-19T19:10:46.242Z"
  }
]
```

## Traps

- **Amazon's buy box can be a used offer, and "Used - Like New" contains "New".** For AirPods B0D1XD1ZV3, `final_price` 182.34 had `variant_condition` "Used: Good" from a third-party seller. In its `other_sellers_prices[]`, 237.14 is "Used - Like New" and the first exact "New" offer is 263.86. Values seen: `variant_condition` null, "Buy New" or "Used: Good"; offer `condition` "New", "Used - Like New", "Used - Very Good", "Used - Good" or "Used - Acceptable". Treat anything starting with "Used" as used; never test for the substring "new". `variant_condition` can be null (Anker B09VPHVT2Z and Hydro Flask B07YXM6XTF on 2026-10-19, and the MX Master 3S B0FB21526X in a later test run). Then take the condition of the `other_sellers_prices` entry whose `seller_name` equals `buybox_seller`. Match on seller only, because that entry's price can be null (Amazon.com on the Hydro Flask). In every case we saw, it was "New". If no entry matches, store is_new as unknown and do not alert.
- **Walmart Restored listings say `condition: "New"`.** 5689919121 is "Restored Apple AirPods Pro 2..." at 173.99 with condition "New". Detect "Restored" in `product_name` or `conditionGroupCode=2` in `url`.
- **Identifiers disagree across stores.** Across 5 products the same GTIN showed up at two stores twice: the Instant Pot on Amazon and Walmart (810028585201), and Anker on Amazon and Target (194644098728), where Target's title says "Anker 24000mAh 140W GaN Prime Power Bank", not 737. Walmart's Anker 737 has Amazon's model number (A1289) but a different GTIN. The three MX Master 3S listings carry three different UPCs. Let GTIN propose a pin and have a human confirm it once, then store the accepted UPC (`confirmed_upcs` in the prompt) so the flag clears.
- **Pin the child ASIN.** The Amazon Hydro Flask B07YXM6XTF is 32 oz Black, one of 89 variations under its parent ASIN, and its `upc` field is a space-separated list of 12 UPCs. Walmart 1327387123 is 32 oz Red. Amazon search-card titles omit the brand.
- **Any store can answer 202.** On 2026-10-19 Walmart and Target returned 202 after about 61 s, and their snapshots were ready at 132 to 164 s for 4 to 5 URLs. In a later test run (2 products) Amazon and Target answered 202 and Walmart answered 200 in 30 s. Handle both answers for every store, in one batch job a day.
- **Target does not carry most of these.** We found the exact SKU at Target for 1 of 5 products. The rest had only nearby models, and one of those was out of stock with no `final_price` and `price_range` "See price in cart". Store `target_tcin: null` and show "not sold here".
- **One missing price is not a price change.** The lighter Amazon price-and-availability scraper (`gd_me8eqo9tqtzc3vim6`, 5 in 8.74 s) returned a price on 3 of 5. For the MX Master 3S it said no price and `in_stock` false, 5 minutes after the full scraper read 79.99 In Stock. Use the full scraper and never alert on a gap.
- **Marketplace buy boxes rotate.** Walmart's AirPods listing read 159.99 (plain fetch, 19:05 UTC), 173.99 (scraper, 19:08) and 159.99 (price-and-availability scraper, 19:15). Store every read with `fetched_at` and the seller.
- **The location is not yours.** Walmart's `store_name` was a different Supercenter on each of 5 records. Amazon records came back set to zipcode 11001, Target to 90077. Pinning a zipcode was not measured.
- **Google Shopping is not a feed for Amazon, Walmart or Target.** 10 queries of 40 tiles: 0 Amazon tiles, 0 Walmart tiles, Target only on items that were not the SKU. Resale shops dominate (eBay, Mercari, Whatnot, Poshmark, TikTok Shop), and tiles include accessories ("RECEIVER - Logitech MX Master 3S", an AirPods case, a 32 oz tumbler). Filter by title and `tag`.
- **Google Shopping churns, so key offers on `headlineOfferDocid`.** Two runs 10m49s apart shared 0% (AirPods) to 100% (Instant Pot) of `productid`s. Keyed on `headlineOfferDocid` (inside `link`), offers changed price 0 times. Keyed on `productid`, two different eBay offers looked like a change from 100.00 to 82.99.
- **Google Shopping: pin the location, retry empty bodies, drop images.** Unpinned `gl=us` landed in varying US cities, and one unpinned product panel came back in INR from Amazon.in. The measured runs used `uule=w+CAIQICImU2FuIEZyYW5jaXNjbyxDYWxpZm9ybmlhLFVuaXRlZCBTdGF0ZXM=` (San Francisco; URL-encode it). Earlier the same day, 6 of 15 first attempts returned a 200 with an empty body, and retries worked. About 94% of the response text across our 10 runs was base64 images (`image`, `image_base64`, `shop_logo`): drop them before you store.
- **Web Unlocker rate limits hide inside a 200.** With 8 Bright Data calls in flight, 2 of 6 Unlocker calls returned HTTP 200 with a 77-byte body and `x-brd-error-code: bucket_rate_limit`. One Walmart page came back as Spanish markdown. Use the scrapers for prices.
- **What works without Bright Data, at small volume.** Plain requests from a home IP in Israel: Amazon search 20 of 20 and product pages 5 of 5 (price on 4 of 5; the miss was the used buy box), Walmart search 5 of 5 and product pages 5 of 5 (read `__NEXT_DATA__`), each in about 1 to 3 s. Target: HTTP 200 but 0 prices and 0 TCINs, because prices render client-side. Google Shopping: 5 of 5 were an enablejs page with 0 prices. Shopify `/products.json?limit=250`: 200 on allbirds.com and brooklinen.com, 404 on anker.com and bombas.com. Volumes above 20 requests were not measured. Walmart HTML contains `px_captcha` even when the data parses, so detect a block by missing `__NEXT_DATA__` items.

## Make it yours

- **Who else sells it:** once a week, pull Google Shopping tiles per product, drop pre-owned `tag`s and accessories, and list the shops under your price. The product panel (`ibp=oshop` plus the tile's `prds` ids) returned 4 to 5 seller offers with `item_price`, `total_price` and `shipping` in 4 to 35 s, but its first attempt needed a retry on 3 of 3.
- **Brand stores too:** some Shopify stores answer `/products.json?limit=250` to a plain GET with `sku`, `price`, `compare_at_price`, `available` and `updated_at` per variant (2 of the 4 we tried).
- **Sale or reprice?** `initial_price` vs `final_price`, plus Amazon's `discount` and `prices_breakdown.deal_type` ("Limited time deal" on the MX Master 3S), tell a temporary promo apart from a new base price. Alert on them differently.
- **Stock-out signal:** when a competitor's `is_available` flips to false, that is not the day to cut your price. Track it next to price.
- **Suggest, do not set:** show the lowest new competitor price next to yours and a suggested price with a floor you choose. One click applies it.
