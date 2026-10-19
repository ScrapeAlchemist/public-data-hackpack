// Build the search-page URLs for Indeed and Glassdoor. Port of python/sources.py: keep the
// two in sync, js/test.mjs checks that both build the same URLs.
//
// What "page" means here (checked through the Bright Data Web Unlocker on 2026-10-15):
//
//   Indeed    page 1 = https://www.indeed.com/jobs?q=<role>&l=<location>   (about 15 listings)
//             page 2 = the same search with &sort=date (newest first, mostly different listings).
//             Indeed's own page 2 (&start=10) shows a login wall to logged-out visitors, and this
//             project only reads public, logged-out pages, so we do not use it.
//
//   Glassdoor page 1 = .../Job/<slug>-jobs-SRCH_IL.0,<L>_IC<locationId>_KO<a>,<b>.htm  (up to 30 listings)
//             page 2 = the same URL with ?fromAge=30 (posted in the last 30 days, mostly different
//             listings). Glassdoor has no URL-based page 2: "Show more jobs" runs in the browser.
//
// Glassdoor needs a numeric location id. KNOWN_LOCATIONS covers common cities so the demo
// needs no extra request; anything else is looked up once through Glassdoor's location
// autocomplete (fetched raw, as JSON) and cached like every other page.

import { WS, floatRepr, pyRepr, quote, strip, urlencode } from './compat.mjs';

export const MAX_PAGES = 2;

/** Python's LookupError: the CLI turns it into "[glassdoor] skipped: ..." instead of a crash. */
export class LookupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LookupError';
  }
}

// (location type, location id) checked against Glassdoor's autocomplete on 2026-10-15.
// Type "C" = city, "S" = state-like region (Glassdoor files "Remote" under S).
export const KNOWN_LOCATIONS = new Map([
  ['san francisco, ca', ['C', 1147401]],
  ['new york, ny', ['C', 1132348]],
  ['seattle, wa', ['C', 1150505]],
  ['los angeles, ca', ['C', 1146821]],
  ['austin, tx', ['C', 1139761]],
  ['boston, ma', ['C', 1154532]],
  ['portland, or', ['C', 1151614]],
  ['remote', ['S', 11047]],
]);
// Bare city names map to the same ids.
for (const [k, v] of [...KNOWN_LOCATIONS]) {
  const city = k.split(',')[0];
  if (!KNOWN_LOCATIONS.has(city)) KNOWN_LOCATIONS.set(city, v);
}

function checkPage(page) {
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGES) {
    throw new RangeError(`page must be 1..${MAX_PAGES}, got ${page}`);
  }
}

/** str() of a value from JSON, as Python prints it inside an f-string. */
function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 2 ** 53 ? String(v) : floatRepr(v);
  return String(v);
}

/** Indeed search URL. page 1 = relevance, page 2 = newest first. */
export function indeedUrl(role, location, page = 1) {
  checkPage(page);
  let url = `https://www.indeed.com/jobs?${urlencode({ q: role, l: location || '' })}`;
  if (page === 2) url += '&sort=date';
  return url;
}

/** 'San Francisco, CA' -> 'san-francisco-ca'. Glassdoor only checks the slug lengths. */
export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Glassdoor search URL. Without a location id it searches the whole US.
 *
 * The path encodes character offsets: IL.0,<L> spans the location slug and
 * KO<start>,<end> spans the keyword slug, so both lengths must match the slugs.
 */
export function glassdoorUrl(role, location, locType = null, locId = null, page = 1) {
  checkPage(page);
  const kw = slugify(role);
  let url;
  if (locId === null || locId === undefined) {
    url = `https://www.glassdoor.com/Job/${kw}-jobs-SRCH_KO0,${kw.length}.htm`;
  } else {
    const loc = slugify(location) || 'x';
    const start = loc.length + 1;
    url = `https://www.glassdoor.com/Job/${loc}-${kw}-jobs-SRCH_IL.0,${loc.length}` +
      `_I${pyStr(locType)}${pyStr(locId)}_KO${start},${start + kw.length}.htm`;
  }
  if (page === 2) url += '?fromAge=30';
  return url;
}

export function glassdoorAutocompleteUrl(location) {
  return 'https://www.glassdoor.com/autocomplete/location?locationTypeFilters=CITY,STATE,COUNTRY' +
    `&caller=jobs&term=${quote(location)}`;
}

function pyTruthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

/**
 * Choose the best hit from Glassdoor's autocomplete JSON. Returns [type, id] or null.
 *
 * Use locationId, not id: for region hits like 'Remote' the two differ.
 */
export function pickLocation(autocompleteJson, location) {
  let hits;
  try {
    hits = JSON.parse(autocompleteJson);
  } catch (e) {
    throw new LookupError(`Glassdoor's location lookup did not return JSON (${e.message})`);
  }
  if (!pyTruthy(hits)) return null;
  if (!Array.isArray(hits)) throw new LookupError("Glassdoor's location lookup returned an unexpected shape");
  const wanted = strip(location).toLowerCase();
  const field = (h, name) => (h && typeof h === 'object' && !Array.isArray(h) ? h[name] : undefined);
  const best = hits.find((h) => {
    const label = field(h, 'label');
    return (typeof label === 'string' && label ? label : '').toLowerCase() === wanted;
  }) ?? hits.find((h) => field(h, 'country2LetterIso') === 'US') ?? hits[0];
  for (const name of ['locationType', 'locationId']) {
    if (field(best, name) === undefined) throw new LookupError(pyRepr(name)); // what Python's KeyError prints
  }
  return [best.locationType, best.locationId];
}

const SPACES = new RegExp(`[${WS}]+`, 'gu');

/**
 * Return [locType, locId] for a location, or [null, null] for a US-wide search.
 *
 * fetchRaw(url) -> Promise<string> is only called for locations missing from KNOWN_LOCATIONS.
 */
export async function resolveGlassdoorLocation(location, fetchRaw = null) {
  if (!location || !strip(location)) return [null, null];
  const key = strip(location).toLowerCase().replace(SPACES, ' ');
  if (KNOWN_LOCATIONS.has(key)) return KNOWN_LOCATIONS.get(key);
  if (!fetchRaw) throw new LookupError(`no Glassdoor location id for ${pyRepr(location)} without a network lookup`);
  const picked = pickLocation(await fetchRaw(glassdoorAutocompleteUrl(location)), location);
  if (picked === null) throw new LookupError(`Glassdoor does not know the location ${pyRepr(location)}`);
  return picked;
}
