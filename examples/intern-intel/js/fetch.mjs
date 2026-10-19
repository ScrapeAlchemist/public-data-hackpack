// Fetch public pages as markdown through the Bright Data Web Unlocker REST API.
// Port of python/fetch.py. Both versions share cache/ and fixtures/, so a page cached by one
// is reused by the other.
//
// Why Node's built-in fetch and not the @brightdata/sdk package: the SDK can return markdown
// too (see sdk_example.mjs), but it retries 429 and 5xx answers on its own and throws on
// 4xx without the x-brd-error-code header. This file needs that header to tell a login wall
// (no retry) from a slow page (one retry). The REST call is one POST:
//
//   POST https://api.brightdata.com/request
//   {"zone": <Web Unlocker zone>, "url": <page>, "format": "raw", "country": "us", "data_format": "markdown"}
//
// Behaviour (same as the Python version):
// - Token from BRIGHTDATA_API_TOKEN (or BRIGHTDATA_API_KEY), from the environment, else this
//   folder's .env, else the hackpack root .env.
// - Zone from BRIGHTDATA_ZONE. If it is empty, we list the account's zones once and use a
//   Web Unlocker ("unblocker") zone.
// - Cache: cache/<sha1(url)>.md, reused while younger than 6 hours. If the network fails and an
//   older cached copy exists, that copy is used and the result says so.
// - Offline: pages come only from fixtures/ (via fixtures/manifest.json). No network, no token.
// - Several URLs run in parallel (at most 6), with request starts at least 50 ms apart.
// - One retry for an empty body, a timeout or a 5xx. No retry for a login wall or a 4xx.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cpSlice, fixed1, strip } from './compat.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = path.join(REPO_ROOT, 'cache');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'fixtures');
const API_URL = 'https://api.brightdata.com/request';
const ZONES_URL = 'https://api.brightdata.com/zone/get_active_zones';
const CACHE_MAX_AGE_S = 6 * 3600;
const MAX_PARALLEL = 6;
const MIN_START_GAP_MS = 50;
const TIMEOUT_MS = 180_000; // per request. Glassdoor pages took over 40 s in testing.

// ---------------------------------------------------------------- .env

/** Read KEY=VALUE lines from a .env file into process.env. Variables already set win. */
export function loadDotenv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    let value = m[2];
    const q = value[0];
    if ((q === '"' || q === "'") && value.indexOf(q, 1) > 0) {
      value = value.slice(1, value.indexOf(q, 1));
      if (q === '"') value = value.replaceAll('\\n', '\n');
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadDotenv(path.join(REPO_ROOT, '.env'));
loadDotenv(path.join(REPO_ROOT, '..', '..', '.env')); // the hackpack root .env (this app lives in examples/)

export class FetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FetchError';
  }
}

export class Page {
  constructor(url, { text = '', origin = '', seconds = 0, error = '' } = {}) {
    this.url = url;
    this.text = text;
    this.origin = origin; // network | cache | stale-cache | fixture
    this.seconds = seconds;
    this.error = error;
  }

  get ok() {
    return !this.error;
  }
}

// ---------------------------------------------------------------- credentials

function token() {
  const tok = strip(process.env.BRIGHTDATA_API_TOKEN || process.env.BRIGHTDATA_API_KEY || '');
  if (!tok) {
    throw new FetchError('No Bright Data API key. Put BRIGHTDATA_API_TOKEN=... in .env ' +
      '(see .env.example in the hackpack root), or run with --offline.');
  }
  return tok;
}

let zonePromise = null;

/** BRIGHTDATA_ZONE, or a Web Unlocker zone found on the account. sdk_example.mjs uses it too. */
export function zone() {
  const z = strip(process.env.BRIGHTDATA_ZONE || '');
  if (z) return Promise.resolve(z);
  if (!zonePromise) {
    zonePromise = discoverUnlockerZone().catch((e) => {
      zonePromise = null; // try again on the next call
      throw e;
    });
  }
  return zonePromise;
}

/** Python requests' exception names, so both versions print the same kind of message. */
function errorName(e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'Timeout';
  return 'ConnectionError';
}

function isNetworkError(e) {
  return e instanceof TypeError || e?.name === 'TimeoutError' || e?.name === 'AbortError';
}

function codePointCompare(a, b) {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

async function discoverUnlockerZone() {
  const headers = { Authorization: `Bearer ${token()}` };
  let res;
  let body;
  try {
    res = await fetch(ZONES_URL, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    body = await res.text();
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    throw new FetchError(`Could not reach Bright Data to list your zones (${errorName(e)}).`);
  }
  raiseForAuth(res.status);
  if (res.status !== 200) {
    throw new FetchError(`Could not list your zones (HTTP ${res.status}). Set BRIGHTDATA_ZONE in .env.`);
  }
  let zones;
  try {
    zones = JSON.parse(body);
  } catch {
    zones = null;
  }
  if (!Array.isArray(zones)) throw new FetchError('Could not read the zone list. Set BRIGHTDATA_ZONE in .env.');
  const names = zones
    .filter((z) => z && z.type === 'unblocker' && z.name)
    .map((z) => z.name)
    .sort(codePointCompare);
  if (!names.length) {
    throw new FetchError('No Web Unlocker zone on this account. Create one in the Bright Data ' +
      'control panel, then set BRIGHTDATA_ZONE=<its name> in .env.');
  }
  console.log(`[fetch] BRIGHTDATA_ZONE not set, using Web Unlocker zone '${names[0]}' ` +
    `(found: ${names.join(', ')})`);
  return names[0];
}

function raiseForAuth(status) {
  if (status === 401) throw new FetchError('Bright Data rejected the API key (HTTP 401). Check BRIGHTDATA_API_TOKEN.');
  if (status === 403) throw new FetchError('The API key is valid but lacks permission for this zone or product (HTTP 403).');
}

// ---------------------------------------------------------------- network

let paceChain = Promise.resolve();
let lastStart = -Infinity;

/** Wait until at least MIN_START_GAP_MS have passed since the previous request started. */
function pace() {
  const turn = paceChain.then(async () => {
    const wait = MIN_START_GAP_MS - (performance.now() - lastStart);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = performance.now();
  });
  paceChain = turn.catch(() => {});
  return turn;
}

async function postOnce(url, markdown) {
  const body = { zone: await zone(), url, format: 'raw', country: 'us' };
  if (markdown) body.data_format = 'markdown';
  await pace();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // The body is UTF-8 but the Content-Type has no charset, so decode it ourselves. Keep a BOM
  // if there is one, as Python's bytes.decode("utf-8") does.
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) };
}

/** One page from Bright Data. Returns the text or throws FetchError. */
export async function fetchNetwork(url, markdown = true) {
  let last = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    let r;
    try {
      r = await postOnce(url, markdown);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      last = `network error: ${errorName(e)}`;
      continue;
    }
    raiseForAuth(r.status);
    const brdError = r.headers.get('x-brd-error-code') || '';
    if (r.status === 200 && strip(r.text)) return r.text;
    if (brdError.includes('reject_')) {
      // e.g. reject_authwall: the site showed a login page. Retrying will not help.
      throw new FetchError(strip(`blocked by the site (${brdError}): ${r.headers.get('x-brd-error') || ''}`));
    }
    if (r.status >= 400 && r.status < 500) {
      const low = r.text.toLowerCase();
      const hint = low.includes('zone') && low.includes('not found') ? ' Check BRIGHTDATA_ZONE in .env.' : '';
      throw new FetchError(`HTTP ${r.status}: ${cpSlice(strip(r.text), 0, 200)}${hint}`);
    }
    last = r.status === 200 ? `empty response (HTTP ${r.status})` : strip(`HTTP ${r.status} ${brdError}`);
  }
  throw new FetchError(`${last}, after one retry`);
}

// ---------------------------------------------------------------- cache and fixtures

export function cachePath(url, markdown = true) {
  return path.join(CACHE_DIR, createHash('sha1').update(url, 'utf8').digest('hex') + (markdown ? '.md' : '.json'));
}

/** The file's exact text: UTF-8, line endings untouched. */
export function readText(file) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file));
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function fixtureManifest() {
  const file = path.join(FIXTURES_DIR, 'manifest.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(readText(file)).pages;
}

function ageSeconds(file) {
  return Date.now() / 1000 - fs.statSync(file).mtimeMs / 1000;
}

/** Get one page. Never throws for fetch problems: they come back in page.error. */
export async function fetchOne(url, { markdown = true, refresh = false, offline = false } = {}) {
  const t0 = performance.now();
  const page = new Page(url);
  try {
    if (offline) {
      const manifest = fixtureManifest();
      const entry = Object.hasOwn(manifest, url) ? manifest[url] : null;
      if (entry === null || entry === undefined) {
        throw new FetchError('no fixture for this URL (offline mode only has the queries in fixtures/manifest.json)');
      }
      page.text = readText(path.resolve(FIXTURES_DIR, entry.file));
      page.origin = 'fixture';
      return page;
    }
    const file = cachePath(url, markdown);
    if (!refresh && fs.existsSync(file) && ageSeconds(file) < CACHE_MAX_AGE_S) {
      page.text = readText(file);
      page.origin = 'cache';
      return page;
    }
    try {
      page.text = await fetchNetwork(url, markdown);
      page.origin = 'network';
      writeText(file, page.text);
    } catch (e) {
      if (!(e instanceof FetchError) || !fs.existsSync(file)) throw e;
      page.text = readText(file); // bad WiFi or a slow site: an old copy beats nothing
      page.origin = 'stale-cache';
    }
  } catch (e) {
    if (!(e instanceof FetchError)) throw e;
    page.error = e.message;
  } finally {
    page.seconds = Number(fixed1((performance.now() - t0) / 1000));
  }
  return page;
}

/** Fetch several pages in parallel. Returns Pages in the same order as urls. */
export async function fetchMany(urls, options = {}) {
  if (!urls.length) return [];
  const pages = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      pages[i] = await fetchOne(urls[i], options);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, urls.length) }, worker));
  return pages;
}
