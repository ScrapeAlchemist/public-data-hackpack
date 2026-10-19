// Reference: count public Reddit posts that contain a brand phrase, per day, with Bright Data Web Unlocker.
// Node 20+, no dependencies. Reads BRIGHTDATA_API_TOKEN (and optional BRIGHTDATA_ZONE) from .env.
//
//   node ideas/07-brand-monitor/reddit_mentions.mjs "notion ai"        (last 7 days)
//   node ideas/07-brand-monitor/reddit_mentions.mjs "notion ai" 2      (last 2 days)
//
// Or import it: import { redditMentions, parseSearchPage } from './reddit_mentions.mjs'
//
// Route (measured on 2026-10-19, see README.md):
//   1. Web Unlocker, raw HTML of https://www.reddit.com/search/?q=%22<phrase>%22&type=posts&sort=new&t=week
//   2. Parse the post blocks (data-testid="search-sdui-post"), 7 per page
//   3. Follow the cursor partial (/svc/shreddit/search/?...&cursor=...) one page at a time, and stop
//      when the oldest post is older than the window. 3 pages took 28.0 s (5.07, 20.71, 2.21 s).
//   Never markdown (it drops votes and timestamps). Never .json (403 plain, 502 through Unlocker).
//   Usernames are never parsed. Posts in user-profile subreddits (u_*) are dropped.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.brightdata.com';
const MAX_PAGES = 50; // 7 posts per page. A busy brand needs about 7 pages per day.

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

// ---- zone ------------------------------------------------------------------

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

// ---- Web Unlocker ----------------------------------------------------------

async function unlocker(url) {
  const zone = await unlockerZone();
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // format raw, no data_format: markdown drops the vote, comment and timestamp attributes.
    const r = await api('/request', { method: 'POST', body: { zone, url, format: 'raw', country: 'us' } });
    if (r.status === 200 && r.text.trim().length > 200) return r.text;
    // An empty 200 (read x-brd-error-code) or a 5xx. Retry up to twice (3 attempts in all, as in AGENTS.md).
    last = `${r.status} ${r.headers.get('x-brd-error-code') || ''}`.trim();
    await sleep(2000);
  }
  throw new Error(`Web Unlocker failed after 3 attempts: ${last}`);
}

// ---- parsing ---------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescapeHtml = (s) => (s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// Reddit writes 2026-10-19T16:13:35.009000+0000. Return 2026-10-19T16:13:35.009Z.
function toIso(ts) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?([+-]\d\d):?(\d\d)$/.exec(ts || '');
  if (!m) return null;
  const frac = (m[2] || '.000').slice(0, 4).padEnd(4, '0');
  const d = new Date(`${m[1]}${frac}${m[3]}:${m[4]}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Parse a search page or a /svc/shreddit/search/ partial. Same markup in both.
export function parseSearchPage(html) {
  const blocks = (html || '').split('data-testid="search-sdui-post"').slice(1);
  const posts = blocks.map((b) => {
    const blk = b.slice(0, 25000);
    const pick = (re) => (re.exec(blk) || [])[1];
    // Two faceplate-number tags per post: votes, then comments. Exact integers, not "1.2k".
    const nums = [...blk.matchAll(/faceplate-number number="(\d+)"/g)].map((m) => Number(m[1]));
    return {
      id: pick(/data-thingid="(t3_[a-z0-9]+)"/) || null,
      title: unescapeHtml(pick(/data-testid="post-title"[^>]*aria-label="([^"]*)"/)) || null,
      subreddit: pick(/&quot;subreddit&quot;:\{&quot;id&quot;:&quot;[^&]+&quot;,&quot;name&quot;:&quot;([^&]+)&quot;/) || null,
      votes: nums.length > 0 ? nums[0] : null,
      comments: nums.length > 1 ? nums[1] : null,
      created: toIso(pick(/faceplate-timeago[^>]*ts="([^"]+)"/)),
      permalink: pick(/data-testid="post-title" href="([^"]+)"/) || null,
    };
  });
  const cur = /src="(\/svc\/shreddit\/search\/\?[^"]*cursor=[^"]+)"/.exec(html || '');
  return {
    posts,
    next: cur ? unescapeHtml(cur[1]) : null,
    // Measured once in 8 pages: a 200 with 0 posts and a "prove your humanity" page.
    challenge: posts.length === 0 && /prove your humanity/i.test(html || ''),
  };
}

// A post in u_<name> lives on a user's profile: the subreddit IS a username. Never store it.
const isUserProfile = (p) => /^u_/i.test(p.subreddit || '') || /^\/user\//i.test(p.permalink || '');

// ---- crawl -----------------------------------------------------------------

export async function redditMentions(phrase, days = 7, { onPage } = {}) {
  const fetchedAt = new Date();
  const cutoff = new Date(fetchedAt.getTime() - days * 86400000);
  // Quote the phrase: unquoted "notion ai" returned about 45 posts a day that say Notion and AI apart.
  const q = encodeURIComponent(`"${phrase}"`).replace(/%20/g, '+');
  // Only t=week was measured. Larger windows use t=month (not measured).
  const t = days <= 7 ? 'week' : 'month';
  let url = `https://www.reddit.com/search/?q=${q}&type=posts&sort=new&t=${t}`;

  const seen = new Set();
  const posts = [];
  let pages = 0;
  let droppedUserProfile = 0;
  let stopped = 'max pages';

  for (let page = 1; page <= MAX_PAGES; page++) {
    const t0 = Date.now();
    let p;
    try {
      p = parseSearchPage(await unlocker(url));
      if (p.challenge) { await sleep(2000); p = parseSearchPage(await unlocker(url)); }
    } catch (e) {
      if (page === 1) throw e;
      stopped = `page ${page} failed: ${e.message}`;
      break;
    }
    pages++;
    for (const x of p.posts) {
      if (!x.id || seen.has(x.id)) continue;
      seen.add(x.id);
      if (!x.created || new Date(x.created) < cutoff) continue;
      if (isUserProfile(x)) { droppedUserProfile++; continue; }
      posts.push(x);
    }
    const times = p.posts.map((x) => x.created).filter(Boolean).sort();
    if (onPage) onPage({ page, posts: p.posts.length, oldest: times[0] || null, seconds: (Date.now() - t0) / 1000 });
    if (!p.posts.length) { stopped = p.challenge ? 'challenge page twice' : 'empty page'; break; }
    if (new Date(times[0]) < cutoff) { stopped = 'older than window'; break; }
    if (!p.next) { stopped = 'end of results'; break; }
    url = 'https://www.reddit.com' + p.next; // sequential: each page holds the cursor for the next
  }

  // One key per UTC day in the window, zeros included, so a chart has no gaps.
  const per_day = {};
  const start = Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate());
  for (let d = start; d <= fetchedAt.getTime(); d += 86400000) per_day[new Date(d).toISOString().slice(0, 10)] = 0;
  for (const x of posts) per_day[x.created.slice(0, 10)] = (per_day[x.created.slice(0, 10)] || 0) + 1;

  return {
    query: `"${phrase}"`,
    days,
    fetched_at: fetchedAt.toISOString(),
    pages,
    stopped,
    dropped_user_profile_posts: droppedUserProfile,
    posts,
    per_day,
  };
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [phrase, daysArg] = process.argv.slice(2);
  const days = Number(daysArg || 7);
  if (!phrase || !(days > 0)) {
    console.error('usage: node reddit_mentions.mjs "<brand phrase>" [days]');
    process.exit(1);
  }
  const t0 = Date.now();
  const onPage = (s) => console.error(`page ${s.page}: ${s.posts} posts, oldest ${s.oldest}, ${s.seconds.toFixed(1)} s`);
  redditMentions(phrase, days, { onPage })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
