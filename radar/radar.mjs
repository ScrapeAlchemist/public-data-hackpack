// AI radar: what is new in AI right now, from Reddit, X and GitHub, in one run.
// Node 20+, no dependencies. Reads BRIGHTDATA_API_TOKEN (optional BRIGHTDATA_ZONE and GITHUB_TOKEN) from .env.
//
//   node radar/radar.mjs                   fetch all three, save the run, print it
//   node radar/radar.mjs --last            print the last saved run again (no fetch)
//   node radar/radar.mjs --only reddit,github
//
// What to watch is in radar/radar.config.json: subreddits, X accounts, the GitHub search.
// Or import it: import { runRadar, loadConfig, lastGood } from './radar.mjs'
//
// Route (measured 2026-10-22, see README.md):
//   Reddit  Web Unlocker, raw HTML of the subreddit's Top Today feed:
//           https://www.reddit.com/svc/shreddit/community-more-posts/top/?t=DAY&name=<sub>
//           One call returned 24 posts on r/LocalLLaMA with score, comments and exact time. 3.3 to 50.5 s.
//   X       Web Scraper API, X posts scraper, discover_by=profile_url with a date window.
//           One job for all accounts: 5 accounts, 7 days, ready in 64 s.
//   GitHub  GitHub's own search API. No Bright Data: it is open. About 1 s.
//   All three start at once. Every run is saved to radar/data/runs/ with fetched_at.

import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, 'data', 'runs');
const API = 'https://api.brightdata.com';
const X_POSTS_SCRAPER = 'gd_lwxkxvnf1cynvib9co';
export const SOURCES = ['reddit', 'x', 'github'];

// ---- env -------------------------------------------------------------------

function loadEnv() {
  // Look for .env in the current folder, then walk up from this file.
  const dirs = [process.cwd()];
  let d = HERE;
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

async function api(path, { method = 'GET', body, timeoutMs = 60000 } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secondsSince = (t0) => Math.round((Date.now() - t0) / 100) / 10;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const errText = (e) => (e && e.name === 'TimeoutError' ? 'timed out' : (e && e.message) || String(e));

// ---- config ----------------------------------------------------------------

export function loadConfig(file = join(HERE, 'radar.config.json')) {
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const clean = (list, re) => (list || []).map((s) => String(s).trim().replace(/^(r\/|\/r\/|@)/i, '')).filter((s) => re.test(s));
  return {
    subreddits: clean(c.subreddits, /^[A-Za-z0-9_]{2,21}$/),
    x_accounts: clean(c.x_accounts, /^[A-Za-z0-9_]{1,15}$/),
    x_days: Number(c.x_days) > 0 ? Number(c.x_days) : 7,
    x_posts_per_account: Number(c.x_posts_per_account) > 0 ? Number(c.x_posts_per_account) : 10,
    github_query: String(c.github_query || 'llm'),
    github_days: Number(c.github_days) > 0 ? Number(c.github_days) : 7,
    github_denylist: (c.github_denylist || []).map((w) => String(w).toLowerCase()).filter(Boolean),
  };
}

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

// ---- Reddit: Web Unlocker --------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescapeHtml = (s) => (s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// Reddit writes 2026-10-22T00:33:11.922000+0000. Return 2026-10-22T00:33:11.922Z.
function toIso(ts) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?([+-]\d\d):?(\d\d)$/.exec(ts || '');
  if (!m) return null;
  const frac = (m[2] || '.000').slice(0, 4).padEnd(4, '0');
  const d = new Date(`${m[1]}${frac}${m[3]}:${m[4]}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const toInt = (s) => (/^-?\d+$/.test(s || '') ? Number(s) : null);

// One <shreddit-post ...> tag per post, all the numbers in its attributes. Ads are <shreddit-ad-post>,
// which this pattern skips. The author attributes are never read.
export function parseTopFeed(html) {
  const posts = [];
  for (const m of (html || '').matchAll(/<shreddit-post\s([^>]*)>/g)) {
    const a = {};
    for (const x of m[1].matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) a[x[1]] = x[2];
    const domain = a.domain || '';
    posts.push({
      id: a.id || null,
      subreddit: a['subreddit-name'] || null,
      title: unescapeHtml(a['post-title']) || null,
      score: toInt(a.score),
      comments: toInt(a['comment-count']),
      created: toIso(a['created-timestamp']),
      permalink: a.permalink ? 'https://www.reddit.com' + unescapeHtml(a.permalink) : null,
      // Link posts point somewhere else (a model card, a repo, a video). Self posts do not.
      link: domain && !domain.startsWith('self.') ? unescapeHtml(a['content-href']) || null : null,
      domain: domain || null,
    });
  }
  return posts;
}

async function redditTop(sub) {
  const zone = await unlockerZone();
  const url = `https://www.reddit.com/svc/shreddit/community-more-posts/top/?t=DAY&name=${encodeURIComponent(sub)}`;
  const tries = [];
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    let why;
    try {
      // format raw, no data_format: markdown drops the score, comment and time attributes.
      const r = await api('/request', { method: 'POST', body: { zone, url, format: 'raw', country: 'us' }, timeoutMs: 60000 });
      if (r.status === 200) {
        const posts = parseTopFeed(r.text);
        if (posts.length) return { sub, url, posts, attempts: attempt, failed_tries: tries, seconds: secondsSince(t0) };
        // Measured once in 9 calls: a 200 "Prove your humanity" page with no x-brd-error-code. Ask again.
        // A 200 with an empty body and an x-brd-error-code (a zone that refuses this IP, for one) lands here too: say which.
        const code = r.headers.get('x-brd-error-code');
        why = code ? `HTTP 200 ${code}` : /prove your humanity/i.test(r.text.slice(0, 5000)) ? 'challenge page' : '0 posts';
      } else if (r.status === 401 || r.status === 403) {
        // A wrong key or a key without permission: asking again will not help.
        throw Object.assign(new Error(`Bright Data answered HTTP ${r.status} ${r.headers.get('x-brd-error') || ''}: check BRIGHTDATA_API_TOKEN and the zone`.replace(/ +:/, ':')), { fatal: true });
      } else {
        why = `HTTP ${r.status} ${r.headers.get('x-brd-error-code') || ''}`.trim();
      }
    } catch (e) {
      if (e.fatal) throw new Error(`r/${sub}: ${e.message}`);
      why = errText(e);
    }
    tries.push(why);
    if (attempt < 3) await sleep(2000);
  }
  throw new Error(`r/${sub}: no posts after 3 tries (${tries.join(', ')})`);
}

export async function fetchReddit(subreddits) {
  const t0 = Date.now();
  if (!subreddits.length) throw new Error('No subreddits in radar.config.json');
  const results = await Promise.allSettled(subreddits.map(redditTop));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (!ok.length) throw new Error(errors.join('; '));
  const posts = ok.flatMap((r) => r.posts).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    seconds: secondsSince(t0),
    per_subreddit: ok.map((r) => ({ sub: r.sub, posts: r.posts.length, attempts: r.attempts, failed_tries: r.failed_tries, seconds: r.seconds, url: r.url })),
    errors,
    posts,
  };
}

// ---- X: Web Scraper API ----------------------------------------------------

export async function fetchX(accounts, days, perAccount) {
  const t0 = Date.now();
  if (!accounts.length) throw new Error('No X accounts in radar.config.json');
  const now = Date.now();
  // end_date = today (UTC) returned posts from earlier today in our tests.
  const input = accounts.map((h) => ({
    url: `https://x.com/${h}`, start_date: isoDay(now - days * 86400000), end_date: isoDay(now),
    num_of_posts: perAccount, include_reposts: false,
  }));
  const q = `dataset_id=${X_POSTS_SCRAPER}&type=discover_new&discover_by=profile_url&format=json&include_errors=true`;
  const trig = await api(`/datasets/v3/trigger?${q}`, { method: 'POST', body: { input }, timeoutMs: 60000 });
  let sid;
  try { sid = JSON.parse(trig.text).snapshot_id; } catch { /* handled below */ }
  if (trig.status !== 200 || !sid) throw new Error(`X trigger failed: HTTP ${trig.status} ${trig.text.slice(0, 200)}`);

  // Poll until ready. Measured: 56 and 64 s. Give up at 4 minutes and keep the snapshot id.
  for (;;) {
    if (Date.now() - t0 > 240000) throw new Error(`X job not ready after 240 s (snapshot ${sid})`);
    await sleep(5000);
    let p;
    try { p = JSON.parse((await api(`/datasets/v3/progress/${sid}`, { timeoutMs: 30000 })).text); } catch { continue; }
    if (p.status === 'ready') break;
    if (p.status === 'failed') throw new Error(`X job failed (snapshot ${sid})`);
  }
  let records;
  for (let i = 0; i < 10 && !records; i++) {
    const d = await api(`/datasets/v3/snapshot/${sid}?format=json`, { timeoutMs: 60000 });
    // A 202 here means "still building" even after progress said ready. Ask again.
    if (d.status === 200) { try { records = JSON.parse(d.text); } catch { /* retry */ } }
    if (!records) await sleep(3000);
  }
  if (!Array.isArray(records)) throw new Error(`X download failed (snapshot ${sid})`);

  const errors = records.filter((r) => r.error || r.error_code)
    .map((r) => `${r.input?.url || r.discovery_input?.url || '?'}: ${r.error || r.error_code}`);
  // include_reposts:false was not honored in our tests: drop reposts here.
  const all = records.filter((r) => !(r.error || r.error_code));
  const posts = all.filter((r) => r.is_repost !== true).map((r) => ({
    id: r.id || null,
    account: r.user_posted || null,
    followers: Number.isFinite(r.followers) ? r.followers : null,
    date: r.date_posted || null,
    text: String(r.description || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    likes: r.likes ?? null,
    replies: r.replies ?? null,
    reposts: r.reposts ?? null,
    views: r.views ?? null,
    url: r.url || null,
  })).sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));
  return { seconds: secondsSince(t0), snapshot_id: sid, records: records.length, reposts_dropped: all.length - posts.length, errors, posts };
}

// ---- GitHub: plain fetch, no Bright Data -----------------------------------

export async function fetchGitHub(query, days, denylist) {
  const t0 = Date.now();
  const q = `${query} created:>=${isoDay(Date.now() - days * 86400000)}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'public-data-hackpack-radar', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (res.status === 403 || res.status === 429) {
    // Without a token the search limit is per IP: a room on one Wi-Fi shares it.
    const left = res.headers.get('x-ratelimit-remaining');
    throw new Error(left === '0' && !process.env.GITHUB_TOKEN
      ? 'GitHub search limit reached for this IP. Add GITHUB_TOKEN to .env (see SETUP.md, step 5)'
      : `GitHub answered HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status !== 200) throw new Error(`GitHub answered HTTP ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  const hidden = [];
  const repos = [];
  for (const r of body.items || []) {
    const hay = `${r.full_name} ${r.description || ''} ${(r.topics || []).join(' ')}`.toLowerCase();
    // Top-by-stars lists surfaced jailbreak and adult repos in our tests. Edit the list in radar.config.json.
    if (denylist.some((w) => hay.includes(w))) { hidden.push(r.full_name); continue; }
    repos.push({
      name: r.full_name,
      description: String(r.description || '').slice(0, 200),
      stars: r.stargazers_count,
      language: r.language || null,
      created: r.created_at,
      url: r.html_url,
    });
  }
  return { seconds: secondsSince(t0), query: q, total_count: body.total_count ?? null, hidden_by_denylist: hidden, repos };
}

// ---- one run ---------------------------------------------------------------

export async function runRadar(config = loadConfig(), { only = SOURCES, onSource } = {}) {
  const fetchedAt = new Date().toISOString();
  const jobs = {
    // X first: it is the slow one (about a minute), so its job starts before the others.
    x: () => fetchX(config.x_accounts, config.x_days, config.x_posts_per_account),
    reddit: () => fetchReddit(config.subreddits),
    github: () => fetchGitHub(config.github_query, config.github_days, config.github_denylist),
  };
  const sources = {};
  await Promise.all(Object.keys(jobs).filter((k) => only.includes(k)).map(async (k) => {
    try {
      sources[k] = { status: 'ok', ...(await jobs[k]()) };
    } catch (e) {
      sources[k] = { status: 'error', error: errText(e) };
    }
    sources[k].finished_at = new Date().toISOString();
    if (onSource) onSource(k, sources[k]);
  }));
  const run = { fetched_at: fetchedAt, config, sources };
  run.file = saveRun(run);
  return run;
}

export function saveRun(run) {
  mkdirSync(RUNS, { recursive: true });
  const file = join(RUNS, run.fetched_at.replace(/[:.]/g, '-') + '.json');
  writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

export function listRuns() {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => join(RUNS, f));
}

// The newest successful result for each source, with the time of its run. The page shows these
// when a live fetch fails or is slow, labeled with that time.
export function lastGood() {
  const out = {};
  for (const f of listRuns()) {
    let run;
    try { run = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    for (const k of SOURCES) {
      if (!out[k] && run.sources?.[k]?.status === 'ok') out[k] = { run_at: run.fetched_at, ...run.sources[k] };
    }
    if (SOURCES.every((k) => out[k])) break;
  }
  return out;
}

// ---- CLI -------------------------------------------------------------------

const n = (v) => (v == null ? '?' : Number(v).toLocaleString('en-US'));
const cut = (s, len) => (s && s.length > len ? s.slice(0, len - 3) + '...' : s || '');

// At most `max` posts per account, by likes, so every account shows up.
export function topPerAccount(posts, max = 3) {
  const seen = {};
  return posts.filter((p) => (seen[p.account] = (seen[p.account] || 0) + 1) <= max);
}

function printRun(run) {
  const s = run.sources;
  const c = run.config;
  console.log(`AI radar, run at ${run.fetched_at}`);
  if (s.reddit) {
    const r = s.reddit;
    console.log(`\nReddit, top today in ${c.subreddits.map((x) => 'r/' + x).join(', ')} (Bright Data Web Unlocker)`);
    if (r.status !== 'ok') console.log(`  failed: ${r.error}`);
    else {
      console.log(`  ${r.posts.length} posts in ${r.seconds} s${r.errors.length ? '; failed: ' + r.errors.join('; ') : ''}`);
      for (const p of r.posts.slice(0, 10)) console.log(`  ${n(p.score).padStart(6)} pts ${n(p.comments).padStart(5)} comments  ${cut(p.title, 80)}`);
    }
  }
  if (s.x) {
    const x = s.x;
    console.log(`\nX, ${c.x_accounts.map((h) => '@' + h).join(', ')}, last ${c.x_days} days (Bright Data Web Scraper API)`);
    if (x.status !== 'ok') console.log(`  failed: ${x.error}`);
    else {
      console.log(`  ${x.posts.length} posts in ${x.seconds} s (${x.reposts_dropped} reposts dropped)${x.errors.length ? '; errors: ' + x.errors.join('; ') : ''}`);
      for (const p of topPerAccount(x.posts, 2)) console.log(`  ${n(p.likes).padStart(7)} likes  @${p.account}: ${cut(p.text, 70)}`);
    }
  }
  if (s.github) {
    const g = s.github;
    console.log(`\nGitHub, new repos for "${c.github_query}", last ${c.github_days} days, by stars (GitHub API, no Bright Data)`);
    if (g.status !== 'ok') console.log(`  failed: ${g.error}`);
    else {
      console.log(`  ${g.repos.length} repos in ${g.seconds} s${g.hidden_by_denylist.length ? ` (${g.hidden_by_denylist.length} hidden by the denylist)` : ''}`);
      for (const p of g.repos.slice(0, 10)) console.log(`  ${n(p.stars).padStart(6)} stars  ${p.name}: ${cut(p.description, 60)}`);
    }
  }
  if (run.file) console.log(`\nSaved ${run.file}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--last')) {
    const f = listRuns()[0];
    if (!f) { console.error('No saved run yet. Run: node radar/radar.mjs'); process.exit(1); }
    printRun(JSON.parse(readFileSync(f, 'utf8')));
  } else {
    const i = args.indexOf('--only');
    const only = i >= 0 ? (args[i + 1] || '').split(',').filter((k) => SOURCES.includes(k)) : SOURCES;
    const t0 = Date.now();
    console.error('Fetching Reddit, X and GitHub at once. X takes about a minute.');
    runRadar(loadConfig(), { only, onSource: (k, r) => console.error(`  ${k}: ${r.status} after ${secondsSince(t0)} s`) })
      .then(printRun)
      .catch((e) => { console.error(e.message); process.exit(1); });
  }
}
