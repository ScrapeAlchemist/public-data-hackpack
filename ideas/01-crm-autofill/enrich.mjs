// Reference: enrich one CRM contact from public LinkedIn data with Bright Data.
// Node 20+, no dependencies. Reads BRIGHTDATA_API_TOKEN (and optional BRIGHTDATA_ZONE) from .env.
//
//   node ideas/01-crm-autofill/enrich.mjs "Satya Nadella" "Microsoft"
//   node ideas/01-crm-autofill/enrich.mjs "Satya Nadella" "Microsoft" https://www.linkedin.com/in/satyanadella
//
// Or import it: import { enrichContact, findProfileUrl, scrape, sameName, mentionsCompany } from './enrich.mjs'
//
// Steps (each one measured on 2026-10-19, see README.md):
//   1. No LinkedIn URL? Ask Google for site:linkedin.com/in "<name>" <company>     2.1-19.8 s
//      Google keeps failing? Search LinkedIn by first + last name instead           64-164 s
//   2. Scrape the profile with the LinkedIn people scraper                         12-60 s
//   3. Check the profile is the right person (same-name slugs exist)
//   4. Scrape the person's current company with the LinkedIn company scraper       4.5-23.9 s

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.brightdata.com';
const PEOPLE_DATASET = 'gd_l1viktl72bvl7bjuj0';
const COMPANY_DATASET = 'gd_l1vikfnt1wgvvqz95w';
const PEOPLE_SEARCH_DATASET = 'gd_m8d03he47z8nwb5xc';

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

// A setup problem that retrying or falling back cannot fix: no key, no zone, or a refused key.
export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

function token() {
  const t = process.env.BRIGHTDATA_API_TOKEN || process.env.BRIGHTDATA_API_KEY;
  if (!t) throw new ConfigError('Set BRIGHTDATA_API_TOKEN in .env (see SETUP.md)');
  return t;
}

const refused = (status) => status === 401 || status === 403;

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
  if (refused(r.status)) throw new ConfigError(`Bright Data refused the API key (HTTP ${r.status}). Check BRIGHTDATA_API_TOKEN in .env.`);
  if (r.status !== 200) throw new Error(`Listing zones returned ${r.status}: ${r.text.slice(0, 200)}`);
  const zones = JSON.parse(r.text || '[]');
  const z = zones.find((x) => x.type === 'unblocker');
  if (!z) throw new ConfigError('No Web Unlocker zone on this account. Add one in the Bright Data control panel.');
  return (zoneCache = z.name);
}

// ---- Google (through Web Unlocker) ----------------------------------------

async function google(query) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&brd_json=1`;
  const zone = await unlockerZone();
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await api('/request', { method: 'POST', body: { zone, url, format: 'raw', country: 'us' } });
    // A refused key or zone will not get better on retry.
    if (refused(r.status)) throw new ConfigError(`Web Unlocker refused the request (HTTP ${r.status}). Check BRIGHTDATA_API_TOKEN and BRIGHTDATA_ZONE in .env.`);
    if (r.status === 200) {
      try { return JSON.parse(r.text); } catch { /* not JSON: see below */ }
    }
    // An empty 200 with x-brd-error-code: captcha (3 of 6 parallel calls in one test), a 200 whose
    // body is not JSON, or a 5xx. Wait and ask again.
    last = `${r.status} ${r.headers.get('x-brd-error-code') || ''} ${r.text.slice(0, 80)}`.trim();
    await sleep(2000 * attempt);
  }
  throw new Error(`Google request failed 4 times: ${last}`);
}

// ---- Web Scraper API -------------------------------------------------------

export async function scrape(datasetId, inputs) {
  const q = `dataset_id=${datasetId}&format=json&include_errors=true`;
  const r = await api(`/datasets/v3/scrape?${q}`, { method: 'POST', body: { input: inputs } });
  if (r.status === 200) return parseRecords(r.text);
  if (r.status !== 202) throw new Error(`Scraper ${datasetId} returned ${r.status}: ${r.text.slice(0, 200)}`);
  // Took longer than about a minute: we got a snapshot to poll.
  return waitForSnapshot(JSON.parse(r.text).snapshot_id);
}

async function trigger(datasetId, inputs) {
  const q = `dataset_id=${datasetId}&format=json&include_errors=true`;
  const r = await api(`/datasets/v3/trigger?${q}`, { method: 'POST', body: { input: inputs } });
  if (r.status !== 200) throw new Error(`Scraper ${datasetId} returned ${r.status}: ${r.text.slice(0, 200)}`);
  return waitForSnapshot(JSON.parse(r.text).snapshot_id);
}

async function waitForSnapshot(snapshot_id) {
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const p = await api(`/datasets/v3/progress/${snapshot_id}`);
    const status = JSON.parse(p.text || '{}').status;
    if (status === 'failed') throw new Error(`Snapshot ${snapshot_id} failed`);
    if (status !== 'ready') continue;
    for (let j = 0; j < 20; j++) {
      const d = await api(`/datasets/v3/snapshot/${snapshot_id}?format=json`);
      if (d.status === 200) return parseRecords(d.text);
      await sleep(5000);
    }
  }
  throw new Error(`Snapshot ${snapshot_id} not ready after 10 minutes`);
}

function parseRecords(text) {
  const t = (text || '').trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [j];
  } catch {
    return t.split('\n').filter(Boolean).map((l) => JSON.parse(l)); // NDJSON
  }
}

const isError = (rec) => Boolean(rec && (rec.error || rec.error_code));

// ---- matching helpers ------------------------------------------------------

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function sameName(a, b) {
  // Every word of the CRM name appears in the LinkedIn name ("Jensen Huang" vs "Jensen Huang").
  const want = norm(a).split(' ').filter((w) => w.length > 1);
  const got = ` ${norm(b)} `;
  return want.length > 0 && want.every((w) => got.includes(` ${w} `));
}

export function mentionsCompany(company, ...texts) {
  const c = norm(company).replace(/\b(inc|corp|corporation|llc|ltd|co|the)\b/g, '').trim();
  return Boolean(c) && texts.some((t) => norm(t).includes(c));
}

// Records come back on locale subdomains with mixed case (https://ph.linkedin.com/in/Jenhsunhuang).
// Normalize before comparing or storing.
export const cleanProfileUrl = (u) => (u || '')
  .replace(/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com/i, 'https://www.linkedin.com')
  .split('?')[0].replace(/\/$/, '').toLowerCase();

// ---- steps -----------------------------------------------------------------

export async function findProfileUrl(name, company) {
  try {
    const url = await findProfileUrlByGoogle(name, company);
    if (url) return url;
  } catch (err) {
    // No key, no zone or a refused key: the fallback cannot fix that, so say it now.
    if (err instanceof ConfigError) throw err;
    // Google kept failing. The people search below is slower but does not go through Google.
  }
  return findProfileUrlByPeopleSearch(name, company);
}

export async function findProfileUrlByGoogle(name, company) {
  const query = `site:linkedin.com/in "${name}" ${company || ''}`.trim();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const serp = await google(query);
    const profiles = (serp.organic || []).filter((r) => /linkedin\.com\/in\//.test(r.link || ''));
    // Now and then Google ignores site: and returns generic results. Ask again.
    if (!profiles.length) continue;
    // Titles look like "Arvind Krishna - Chairman and Chief Executive Officer, IBM", or just "Lisa Su".
    const named = profiles.filter((r) => sameName(name, (r.title || '').split(' - ')[0]));
    // Several people share a name. Prefer the result that mentions the company.
    const best = named.find((r) => mentionsCompany(company, r.title, r.description)) || named[0];
    return best ? cleanProfileUrl(best.link) : null;
  }
  return null;
}

// LinkedIn people search scraper: first + last name in, same-name profiles out (11 for Satya
// Nadella, 46 for Mary Barra). Measured: 3 names in one job, 82.5 s, every target at rank 1.
export async function findProfileUrlByPeopleSearch(name, company) {
  const [first, ...rest] = name.trim().split(/\s+/);
  if (!rest.length) return null;
  const recs = (await trigger(PEOPLE_SEARCH_DATASET, [
    { url: 'https://www.linkedin.com', first_name: first, last_name: rest.join(' ') },
  ])).filter((r) => r && !isError(r) && r.url);
  const named = recs.filter((r) => sameName(name, r.name));
  // experience is not always an array in these records. Read it as text.
  const exp = (r) => [].concat(r.experience ?? []).slice(0, 2).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  const best = named.find((r) => mentionsCompany(company, r.subtitle, ...exp(r))) || named[0];
  return best ? cleanProfileUrl(best.url) : null;
}

export async function enrichContact({ name, company, linkedin_url }) {
  const out = { fetched_at: new Date().toISOString(), person: null, company: null, checks: {}, sources: {} };

  const url = linkedin_url ? cleanProfileUrl(linkedin_url) : await findProfileUrl(name, company);
  if (!url) { out.checks.found = false; return out; }
  out.sources.person = url;

  const [p] = (await scrape(PEOPLE_DATASET, [{ url }])).filter((r) => r);
  if (!p || isError(p)) {
    // dead_page and similar arrive inside a 200. Hidden profiles end here.
    out.checks.found = false;
    out.checks.error = p ? (p.error_code || p.error) : 'no record';
    return out;
  }

  const cc = p.current_company || {};
  out.person = {
    name: p.name,
    // position is null on some public profiles (4 of 9 CEOs we tried); fall back to the current role.
    title: p.position || cc.title || p.experience?.[0]?.title || null,
    company: cc.name || p.current_company_name || null,
    location: p.city || p.location || null,
    followers: p.followers ?? null, // exact integer; public pages only show "12M"
    connections: p.connections ?? null,
    linkedin_url: cleanProfileUrl(p.url || url),
  };
  out.checks.found = true;
  // Same-name slugs exist (2 of 13 CEO slugs we tried were someone else). Never trust the slug alone.
  out.checks.name_match = sameName(name, p.name);
  // true or false when both sides name a company. null when it cannot be checked: the contact has
  // no company, or the profile lists none at all (2 of 9 correct CEO profiles). null is not a mismatch.
  const profileCompanies = [cc.name, p.current_company_name, p.position, p.experience?.[0]?.company].filter(Boolean);
  out.checks.company_match = company && profileCompanies.length
    ? mentionsCompany(company, ...profileCompanies)
    : null;

  const companyId = cc.company_id || p.current_company_company_id;
  if (companyId) {
    const companyUrl = `https://www.linkedin.com/company/${companyId}`;
    out.sources.company = companyUrl;
    const [c] = (await scrape(COMPANY_DATASET, [{ url: companyUrl }])).filter((r) => r);
    if (c && !isError(c)) {
      out.company = {
        name: c.name,
        industry: c.industries || null,
        size: c.company_size || null,
        employees_on_linkedin: c.employees_in_linkedin ?? null,
        headquarters: c.headquarters || null,
        website: c.website || null,
        followers: c.followers ?? null,
        founded: c.founded ?? null,
      };
      // A record with no headquarters and no website is partial (Amazon came back that way, no error flag).
      out.checks.company_partial = !c.headquarters && !c.website;
    }
  }
  return out;
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, company, linkedin_url] = process.argv.slice(2);
  if (!name) {
    console.error('usage: node enrich.mjs "<name>" "<company>" [linkedin_url]');
    process.exit(1);
  }
  const t0 = Date.now();
  enrichContact({ name, company, linkedin_url })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
