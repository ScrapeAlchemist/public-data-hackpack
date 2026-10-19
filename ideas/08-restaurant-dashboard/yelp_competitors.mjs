// Reference: every competitor in one Yelp category within N miles of an address, with the exact
// rating and exact review count, through Bright Data Web Unlocker (raw HTML).
// Node 20+, no dependencies. Reads BRIGHTDATA_API_TOKEN (and optional BRIGHTDATA_ZONE) from .env.
//
//   node ideas/08-restaurant-dashboard/yelp_competitors.mjs "2400 Telegraph Ave, Berkeley, CA" ramen 1
//   node ideas/08-restaurant-dashboard/yelp_competitors.mjs "2400 Telegraph Ave, Berkeley, CA" ramen 1 --all-coords
//
// Or import it: import { findCompetitors, parseSearch, parseBiz } from './yelp_competitors.mjs'
//
// Steps (measured 2026-10-19 for 1 mile, see README.md):
//   1. One search page for the address. Read Yelp's distance boxes from the radio inputs named l
//      (Walking (1 mi.), Biking (2 mi.), ...). Each one is a g:minLng,minLat,maxLng,maxLat box.
//   2. cflt=<category alias> search inside two boxes, every page, at most 6 requests at once:
//      the inner box (fits inside the circle, so every result in it is in range) and the outer
//      box (contains the circle). For 1 mile that is Walking (1 mi.) and Biking (2 mi.).
//      Search pages took 14.2 to 34.5 s each.
//   3. Outer-box results that are not in the inner box: fetch the biz page once for lat/lng
//      (13.4 to 39.8 s each, cached by biz_id) and keep the ones within N miles by haversine.
// Boxes and coordinates are cached in ./cache/yelp_coords.json, so a weekly rerun is mostly search pages.
// Never add open_now=1 to a Yelp URL: it got a hard block (0 bytes) on 2026-10-19.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.brightdata.com';
const MAX_PARALLEL = 6;
const MAX_PAGES = 10; // 100 results per box; one category near one address is far below that

// ---- env -------------------------------------------------------------------

function loadEnv() {
  // Look for .env in the current folder, then walk up from this file.
  const dirs = [process.cwd()];
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) { dirs.push(d); d = resolve(d, '..'); }
  for (const dir of dirs) {
    const p = join(dir, '.env');
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
    break;
  }
}
loadEnv();

function token() {
  const t = process.env.BRIGHTDATA_API_TOKEN || process.env.BRIGHTDATA_API_KEY;
  if (!t) throw new Error('Set BRIGHTDATA_API_TOKEN in .env (see SETUP.md)');
  return t;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let zoneCache;
async function unlockerZone() {
  if (process.env.BRIGHTDATA_ZONE) return process.env.BRIGHTDATA_ZONE;
  if (zoneCache) return zoneCache;
  const r = await api('/zone/get_active_zones');
  // A wrong key answers with plain text ("Invalid credentials"), not JSON: say so instead of a parse error.
  if (r.status !== 200) throw new Error(`Zone lookup failed (HTTP ${r.status}): check BRIGHTDATA_API_TOKEN`);
  const zones = JSON.parse(r.text || '[]');
  if (!Array.isArray(zones)) throw new Error('Zone lookup returned no zone list: check BRIGHTDATA_API_TOKEN');
  const z = zones.find((x) => x.type === 'unblocker');
  if (!z) throw new Error('No Web Unlocker zone on this account. Add one in the Bright Data control panel.');
  return (zoneCache = z.name);
}

// ---- Web Unlocker: one raw Yelp page, at most 6 in flight -----------------

let active = 0;
const waiting = [];
async function limited(fn) {
  if (active < MAX_PARALLEL) active++;
  else await new Promise((r) => waiting.push(r)); // a finishing call hands its slot over
  try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
}

// Every Web Unlocker call this process made. For one scan's count, pass a counter (see findCompetitors).
export const stats = { calls: 0 };

// counter: optional { calls: 0 } object. Each attempt, retries included, adds 1 to it.
export async function unlockerPage(url, counter) {
  return limited(async () => {
    const zone = await unlockerZone();
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
      // format raw, never markdown: markdown rounds review counts to "2.3k".
      const r = await api('/request', { method: 'POST', body: { zone, url, format: 'raw', country: 'us' } });
      stats.calls++;
      if (counter) counter.calls++;
      // A real page is about 1 MB and carries a data-apollo-state script. A DataDome block page is under 1 KB.
      if (r.status === 200 && r.text.includes('data-apollo-state')) return r.text;
      last = `${r.status} ${r.headers.get('x-brd-error-code') || ''} (${r.text.length} bytes)`;
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
      await sleep(2000);
    }
    throw new Error(`Web Unlocker failed for ${url}: ${last}`);
  });
}

// ---- parsing (pure, no network) -------------------------------------------

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
function unescapeHtml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// JSON blobs inside <script> tags whose attributes pass the test. The Apollo blob is
// wrapped in <!-- --> and HTML-escaped (&quot;); the hypernova blob is plain JSON.
function scriptJson(html, attrTest) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!attrTest(m[1])) continue;
    let body = m[2].trim();
    if (body.startsWith('<!--')) body = body.slice(4);
    if (body.endsWith('-->')) body = body.slice(0, -3);
    for (const cand of [body, unescapeHtml(body)]) {
      try { out.push(JSON.parse(cand)); break; } catch { /* try the unescaped form */ }
    }
  }
  return out;
}

function walk(o, fn) {
  if (Array.isArray(o)) { for (const v of o) walk(v, fn); return; }
  if (!o || typeof o !== 'object') return;
  fn(o);
  for (const v of Object.values(o)) walk(v, fn);
}

function apolloOf(html) {
  const ap = {};
  for (const b of scriptJson(html, (a) => a.includes('data-apollo-state'))) {
    if (b && typeof b === 'object') Object.assign(ap, b);
  }
  return ap;
}

const deref = (ap, v) => (v && typeof v === 'object' && v.__ref ? ap[v.__ref] || {} : v);

function bizFromApollo(ap, encid) {
  const b = ap[`Business:${encid}`];
  if (!b) return null;
  const loc = deref(ap, b.location) || {};
  const addr = loc.address || {};
  const pr = b.priceRange;
  const alertKey = Object.keys(b).find((k) => k.startsWith('activeAlert'));
  return {
    biz_id: encid,
    slug: b.alias || null,
    name: unescapeHtml(b.name || ''),
    rating: b.rating ?? null, // null for a new business with 0 reviews
    review_count: b.reviewCount ?? null, // exact integer
    price: (pr && typeof pr === 'object' ? pr.display : pr) || '', // '' = Yelp shows no price level
    categories: (b.categories || []).map((c) => deref(ap, c)?.title).filter(Boolean).map(unescapeHtml),
    address: addr.addressLine1 || '',
    city: addr.city || '',
    // Search pages only. 'tempclosed' sat on a business whose biz page said "Temporarily closed"
    // while its isClosed was false, so read this, not isClosed, for temporary closures.
    alert: (alertKey && b[alertKey]?.type) || null,
  };
}

// A search page: organic rows in rank order (ads dropped), totals, and the distance boxes.
export function parseSearch(html) {
  const ap = apolloOf(html);
  const [hyper] = scriptJson(html, (a) => a.includes('data-hypernova-key'));
  const res = { total_results: null, start: 0, per_page: 10, boxes: {}, rows: [], ads_dropped: 0 };
  const ids = [];
  const ads = new Set();
  walk(hyper || {}, (o) => {
    if (o.searchResultBusiness?.isAd) ads.add(o.searchResultBusiness.name);
    if ('totalResults' in o && 'startResult' in o && res.total_results === null) {
      res.total_results = o.totalResults;
      res.start = o.startResult || 0;
      res.per_page = o.resultsPerPage || 10;
    }
    if (o.name === 'l' && o.text && typeof o.value === 'string' && o.value.startsWith('g:')) {
      res.boxes[o.text] = o.value;
    }
    // Organic results hold only a bizId (searchResultBusiness is null). Ads carry isAd: true.
    if (o.componentType === 'vertical_organic' && Array.isArray(o.searchResults)) {
      for (const sr of o.searchResults) {
        if (sr?.searchResultBusiness?.isAd) continue;
        if (sr?.bizId && !ids.includes(sr.bizId)) ids.push(sr.bizId);
      }
    }
  });
  res.ads_dropped = ads.size;
  res.rows = ids.map((id, i) => ({ rank: res.start + i + 1, ...(bizFromApollo(ap, id) || { biz_id: id }) }));
  return res;
}

// A biz page: the same fields plus lat/lng (from the map image's center=), claimed and closed.
export function parseBiz(html, slug) {
  const ap = apolloOf(html);
  const entries = Object.entries(ap).filter(([k, v]) => k.startsWith('Business:') && v && typeof v === 'object');
  const hasMap = ([, v]) => Object.keys(v).some((k) => k.startsWith('map('));
  const hit = entries.find(([, v]) => v.alias === slug) || entries.find(hasMap);
  if (!hit) return null;
  const [key, b] = hit;
  const mapKey = Object.keys(b).find((k) => k.startsWith('map(') && b[k]?.src);
  const m = (mapKey ? b[mapKey].src : '').match(/center=(-?[\d.]+)(?:%2C|,)(-?[\d.]+)/i);
  const claim = b['claimability({"useConsumerClaimability":true})'] || {};
  return {
    ...bizFromApollo(ap, key.slice('Business:'.length)),
    lat: m ? Number(m[1]) : null,
    lng: m ? Number(m[2]) : null,
    is_claimed: claim.isClaimed ?? null,
    is_closed: b.isClosed ?? null, // false during a temporary closure: check closed_until too
    closed_until: b.closedUntil ?? null,
  };
}

// ---- geometry --------------------------------------------------------------

export function haversineMi(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(a));
}

function box(label, value) {
  const [minLng, minLat, maxLng, maxLat] = value.slice(2).split(',').map(Number);
  const lat = (minLat + maxLat) / 2;
  const lng = (minLng + maxLng) / 2;
  return {
    label, value, minLng, minLat, maxLng, maxLat, lat, lng,
    half_mi: Math.min(haversineMi(lat, lng, maxLat, lng), haversineMi(lat, lng, lat, maxLng)),
    corner_mi: haversineMi(lat, lng, maxLat, maxLng),
  };
}

// The Walking (1 mi.) box is a square of about 1.4 x 1.4 mi, not a radius. So: the inner box is
// the biggest box whose corners are within the radius, the outer box the smallest that holds the circle.
export function pickBoxes(boxes, miles) {
  const all = Object.entries(boxes).map(([label, value]) => box(label, value));
  const outer = all.filter((b) => b.half_mi >= miles).sort((a, b) => a.half_mi - b.half_mi)[0];
  const inner = all.filter((b) => b.corner_mi <= miles).sort((a, b) => b.corner_mi - a.corner_mi)[0] || null;
  if (!outer) throw new Error(`${miles} mi is bigger than any Yelp distance box on this page`);
  return { inner, outer };
}

// ---- cache (boxes per address, coordinates per biz_id) ---------------------

const cacheFile = () => join(process.env.YELP_CACHE_DIR || join(process.cwd(), 'cache'), 'yelp_coords.json');
function readCache() {
  try { return JSON.parse(readFileSync(cacheFile(), 'utf8')); } catch { return { boxes: {}, coords: {} }; }
}
function writeCache(c) {
  mkdirSync(dirname(cacheFile()), { recursive: true });
  writeFileSync(cacheFile(), JSON.stringify(c, null, 2));
}

// ---- the pipeline ----------------------------------------------------------

const searchUrl = (address, alias, l, start) => {
  const q = new URLSearchParams({ cflt: alias, find_loc: address }); // cflt, never find_desc
  if (l) q.set('l', l);
  if (start) q.set('start', String(start));
  return `https://www.yelp.com/search?${q}`;
};

async function searchBox(address, alias, l, getPage) {
  const first = parseSearch(await getPage(searchUrl(address, alias, l, 0)));
  const total = first.total_results ?? first.rows.length;
  const starts = [];
  for (let s = first.per_page; s < Math.min(total, MAX_PAGES * first.per_page); s += first.per_page) starts.push(s);
  const rest = await Promise.all(starts.map(async (s) => parseSearch(await getPage(searchUrl(address, alias, l, s)))));
  const rows = new Map();
  for (const p of [first, ...rest]) for (const r of p.rows) if (!rows.has(r.biz_id)) rows.set(r.biz_id, r);
  return { total, rows: [...rows.values()] };
}

export async function findCompetitors(address, alias, miles = 1, { allCoords = false, getPage = unlockerPage } = {}) {
  const fetched_at = new Date().toISOString();
  // This scan's own call counter, handed to getPage with every URL. bd_calls then counts this scan
  // only, even in a long-running server or with two scans at once.
  const counter = { calls: 0 };
  const page = (url) => getPage(url, counter);
  const cache = readCache();
  const addrKey = address.trim().toLowerCase();

  // 1. Distance boxes for this address (cached: they depend on the address only).
  let boxes = cache.boxes[addrKey]?.boxes;
  if (!boxes) {
    boxes = parseSearch(await page(searchUrl(address, alias))).boxes;
    if (!Object.keys(boxes).length) throw new Error('No distance boxes on the search page. Check the address.');
    cache.boxes[addrKey] = { boxes, fetched_at };
  }
  const { inner, outer } = pickBoxes(boxes, miles);
  const center = { lat: outer.lat, lng: outer.lng };

  // 2. Category search in both boxes, in parallel.
  const [innerRes, outerRes] = await Promise.all([
    inner ? searchBox(address, alias, inner.value, page) : { rows: [] },
    searchBox(address, alias, outer.value, page),
  ]);
  const inInner = new Set(innerRes.rows.map((r) => r.biz_id));
  const candidates = [...outerRes.rows];
  for (const r of innerRes.rows) if (!candidates.some((c) => c.biz_id === r.biz_id)) candidates.push(r);

  // 3. Coordinates from biz pages, only where needed and not cached.
  const needCoords = candidates.filter((r) => (allCoords || !inInner.has(r.biz_id)) && !cache.coords[r.biz_id]);
  const failed = new Set();
  await Promise.all(needCoords.map(async (r) => {
    try {
      const b = parseBiz(await page(`https://www.yelp.com/biz/${r.slug}`), r.slug);
      if (b?.lat == null) throw new Error('no map center on the biz page');
      cache.coords[r.biz_id] = { slug: r.slug, lat: b.lat, lng: b.lng, fetched_at };
    } catch (e) {
      failed.add(r.biz_id);
      console.error(`coords failed for ${r.slug}: ${e.message}`);
    }
  }));
  writeCache(cache);

  const out = {
    address, category: alias, miles, fetched_at, center,
    boxes: { inner: inner?.label || null, outer: outer.label },
    competitors: [], outside_radius: [], unchecked: [],
  };
  for (const r of candidates) {
    const c = cache.coords[r.biz_id];
    const dist = c ? Number(haversineMi(center.lat, center.lng, c.lat, c.lng).toFixed(3)) : null;
    const row = {
      biz_id: r.biz_id, slug: r.slug, name: r.name, rating: r.rating, review_count: r.review_count,
      price: r.price, categories: r.categories, address: r.address, alert: r.alert ?? null,
      lat: c?.lat ?? null, lng: c?.lng ?? null, dist_mi: dist,
      url: `https://www.yelp.com/biz/${r.slug}`,
    };
    if (inInner.has(r.biz_id) || (dist !== null && dist <= miles)) out.competitors.push(row);
    else if (failed.has(r.biz_id)) out.unchecked.push(row);
    else out.outside_radius.push({ biz_id: r.biz_id, slug: r.slug, name: r.name, rating: r.rating, review_count: r.review_count, dist_mi: dist });
  }
  out.bd_calls = counter.calls; // this scan's Web Unlocker calls, retries included
  return out;
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const [address, alias, miles] = args;
  if (!address || !alias) {
    console.error('usage: node yelp_competitors.mjs "<address>" <category alias, e.g. ramen> [miles=1] [--all-coords]');
    process.exit(1);
  }
  const t0 = Date.now();
  findCompetitors(address, alias, miles ? Number(miles) : 1, { allCoords: process.argv.includes('--all-coords') })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      console.error(`${r.competitors.length} competitors, ${r.bd_calls} Web Unlocker calls, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
