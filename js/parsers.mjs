// Turn Indeed and Glassdoor search-page markdown into rows. Port of python/parsers.py:
// the two must return identical rows for identical markdown (js/test.mjs checks this).
//
// Row = {source, title, company, location, pay, pay_hourly_min, rating, url, job_id}
// Glassdoor rows have one more field, indeed_jk (see "Glassdoor and Indeed twins" below).
//
// The parsers accept both markdown renderings we have seen for the same page:
//   - REST /request with data_format=markdown: '*   ### [Title](/rc/clk?jk=...)', 4-space
//     indents, logos as ![Company Logo](...), '&hellip;'.
//   - MCP scrape_as_markdown: bare lines, '&' escaped as '\&' (also inside URLs), logos as
//     plain 'Company Logo' text.
// cleanLines() reduces both to the same list of plain lines, then the parsers walk it.
//
// Layout of one listing after cleanLines():
//
//   Indeed     [Title](/rc/clk?jk=<16 hex>&...)      (or /viewjob?jk=, /pagead/clk?)
//              optional badges (Easily apply, ...)
//              Company
//              Location                              ('City, ST', 'City, ST 94105', 'Remote', 'Hybrid work in ...')
//              optional '(Chelsea area)' / 'Transit information' + stop name
//              optional pay ('$62 an hour', '$8,000 - $10,000 a month', 'From $105,000 a year')
//              job type, schedule, snippet lines, 'View all ...',
//              'Salary Search: [...](...fromjk=<16 hex>...)'
//   The list ends at the pagination line '[1](#)'. After it the page embeds the first job's
//   full description, which we ignore.
//
//   Glassdoor  optional 'Company Logo'
//              Company
//              optional rating ('3.4')
//              [Title](https://www.glassdoor.com/job-listing/...htm?jl=<id>)
//              optional location (missing on some listings)
//              optional pay ('$25.18 - $35.19 Per Hour (Employer provided)', '$58K - $98K (Glassdoor est.)')
//              optional badges, snippet, 'Skills: ...'
//
// Every Indeed page we saved has one repeated entry: a /viewjob?jk=<synthetic-looking id> copy
// of a real listing. Usually its 'Salary Search' link still carries the real id as fromjk, so a
// /viewjob entry whose jk differs from its fromjk is dropped. Some 'Salary Search' lines have no
// link; a /viewjob entry like that is dropped when another entry on the page has the same
// title, company, location and pay. Sponsored entries whose link has no jk have no job id and
// are skipped.
//
// Indeed sometimes serves the US search page in Spanish ('$50 por hora', 'Busqueda de
// salarios:' with an accent). The parser reads the Spanish pay units and badge we have seen;
// indeedIsSpanish() lets the caller fetch the page once more.
//
// Glassdoor and Indeed twins: many Glassdoor listings carry a partner link
// '/partner/jobListing.htm?...jobListingId=<jl>&jrtk=5-...-<16 hex>'. The last 16 hex digits
// of jrtk are the Indeed jk of the same posting. parseGlassdoor stores them as indeed_jk
// (null when the link is missing), and dedupe.mergeRows joins on it before it compares names.
//
// Regexes use Python's definitions of whitespace, digits and word boundaries (see compat.mjs).

import { WS, WORD, cpLen, pyFloat, pyFloor, splitLines, strip } from './compat.mjs';

// ---------------------------------------------------------------- cleaning

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '\u{2026}' };
const ENTITY = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g;
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!&|<>~])/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const ODD_SPACES = /[\u{a0}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}]/gu;
const BULLETS = new RegExp(`^(?:[*+\\-][${WS}]+)+`, 'u');
const HEADING = new RegExp(`^#{1,6}[${WS}]+`, 'u');

function entity(match, name) {
  // String.fromCodePoint throws above U+10FFFF, like Python's chr().
  if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
  if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
  return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : match; // unknown names stay as written
}

/** Markdown -> list of non-empty plain lines (bullets, headings, bold, images removed). */
export function cleanLines(md) {
  md = md.replace(ENTITY, entity);
  md = md.replace(ESCAPED, '$1');
  md = md.replace(ODD_SPACES, ' ');
  const out = [];
  for (const raw of splitLines(md)) {
    let s = strip(raw);
    s = s.replace(BULLETS, ''); // list bullets, possibly nested
    s = s.replace(HEADING, ''); // headings
    s = s.replace(IMAGE, '$1'); // images -> alt text
    s = strip(s.replaceAll('**', ''));
    if (s) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------- pay

const AMOUNT = new RegExp(`\\$[${WS}]?(\\p{Nd}[\\p{Nd},]*(?:\\.\\p{Nd}+)?)[${WS}]*([kK])?`, 'u');
const DAY = new RegExp(`(?<!${WORD})day(?!${WORD})`, 'u');

/**
 * Half-up rounding to cents. Same float steps as Python's math.floor(x * 100 + 0.5) / 100.
 */
export function round2(x) {
  return pyFloor(x * 100 + 0.5) / 100;
}

/**
 * Lower bound of a pay string in USD per hour, or null.
 *
 * Units: 'hour' = 1, 'year' = /2080, 'month' = /173.33, 'week' = /40, 'day' = /8, 'K' = x1000.
 * Spanish Indeed pages: 'por hora' = 1, 'por mes' = /173.33, 'por a\u{f1}o' = /2080.
 * Glassdoor often shows no unit. Then: a K amount is yearly, under $300 is hourly, anything
 * else is monthly (Glassdoor's unit-less ranges matched Indeed's 'a month' for the same jobs).
 * 'Up to $X' has no lower bound, so it gives null.
 */
export function payHourlyMin(pay) {
  if (!pay) return null;
  const p = pay.toLowerCase();
  if (p.startsWith('up to')) return null;
  const m = AMOUNT.exec(pay);
  if (!m) return null;
  let value = pyFloat(m[1].replaceAll(',', ''));
  const hasK = m[2] !== undefined;
  if (hasK) value *= 1000;
  let divisor;
  if (p.includes('hour') || p.includes('/hr') || p.includes('por hora')) divisor = 1;
  else if (p.includes('year') || p.includes('/yr') || p.includes('annual') || p.includes('por a\u{f1}o')) divisor = 2080;
  else if (p.includes('month') || p.includes('/mo') || p.includes('por mes')) divisor = 173.33;
  else if (p.includes('week') || p.includes('/wk')) divisor = 40;
  else if (DAY.test(p)) divisor = 8;
  else if (hasK) divisor = 2080;
  else if (value < 300) divisor = 1;
  else divisor = 173.33;
  return round2(value / divisor);
}

// ---------------------------------------------------------------- Indeed

const IN_LINK = new RegExp(`^\\[(?<title>[^\\n]+?)\\]\\((?<href>/(?:rc/clk|viewjob|pagead/clk)[^)${WS}]*)\\)$`, 'u');
const IN_JK = /[?&]jk=([0-9a-f]{16})/;
const IN_FROMJK = /[?&]fromjk=([0-9a-f]{16})/;
const IN_PAY = /^(?:From |Up to )?\$\p{Nd}[\p{Nd},.]*K?(?: - \$\p{Nd}[\p{Nd},.]*K?)? (?:an hour|a year|a month|a week|a day|por hora|por mes|por a\u{f1}o)$/u;
const IN_BADGES = new Set(['Easily apply', 'Responsive employer', 'Urgently hiring', 'New', 'Sponsored',
  'Hiring multiple candidates', 'Actively hiring',
  'Post\u{fa}late r\u{e1}pidamente']); // Spanish page: 'Easily apply'
const IN_ZIP = new RegExp(`[${WS}]+\\p{Nd}{5}$`, 'u');
const IN_SPANISH = 'B\u{fa}squeda de salarios:'; // Spanish page: 'Salary Search:'

/** True when Indeed served the search page in Spanish. */
export function indeedIsSpanish(md) {
  return cleanLines(md).some((line) => line.startsWith(IN_SPANISH));
}

function indeedEnd(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '[1](#)' || line.startsWith('Get email updates') || line === 'People also searched:') return i;
  }
  return lines.length;
}

export function parseIndeed(md) {
  const lines = cleanLines(md);
  const end = indeedEnd(lines);
  const starts = [];
  for (let i = 0; i < end; i++) if (IN_LINK.test(lines[i])) starts.push(i);
  const rows = [];
  const unchecked = [];
  starts.forEach((s, n) => {
    const m = IN_LINK.exec(lines[s]);
    const block = lines.slice(s + 1, n + 1 < starts.length ? starts[n + 1] : end);
    const href = m.groups.href;
    const jkMatch = IN_JK.exec(href);
    const jk = jkMatch ? jkMatch[1] : null;
    let fromjk = null;
    for (const line of block) {
      const f = IN_FROMJK.exec(line);
      if (f) { fromjk = f[1]; break; }
    }
    if (href.startsWith('/viewjob') && fromjk && jk !== fromjk) return; // repeated copy of another listing on this page
    const jobId = jk || fromjk;
    if (!jobId) return;
    const b = block.filter((x) => !IN_BADGES.has(x));
    const company = b.length ? b[0] : null;
    const location = b.length > 1 ? b[1].replace(IN_ZIP, '') : null;
    const pay = b.slice(2).find((x) => IN_PAY.test(x)) ?? null;
    rows.push({
      source: 'indeed',
      title: strip(m.groups.title),
      company,
      location,
      pay,
      pay_hourly_min: payHourlyMin(pay),
      rating: null,
      url: `https://www.indeed.com/viewjob?jk=${jobId}`,
      job_id: jobId,
    });
    unchecked.push(href.startsWith('/viewjob') && !fromjk);
  });
  // A /viewjob entry without a fromjk to compare: drop it when it repeats another entry's
  // title, company, location and pay.
  const shown = new Set(rows.filter((r, i) => !unchecked[i]).map(card));
  return rows.filter((r, i) => !(unchecked[i] && shown.has(card(r))));
}

function card(row) {
  return JSON.stringify([row.title, row.company, row.location, row.pay]);
}

// ---------------------------------------------------------------- Glassdoor

const GD_LINK = new RegExp(
  `^\\[(?<title>[^\\n]+?)\\]\\((?<url>https://www\\.glassdoor\\.com/job-listing/[^)${WS}?]+)\\?(?:[^)${WS}]*&)?jl=(?<id>\\p{Nd}+)[^)${WS}]*\\)$`,
  'u',
);
const GD_RATING = /^\p{Nd}(?:\.\p{Nd})?$/u;
const GD_PAY = /^\$\p{Nd}/u;
const GD_NOT_LOCATION = /^(?:\$|Skills:|Easy Apply$|Best Places to Work$|\[)/;
const GD_ESTIMATE = '(Glassdoor est.)';
const GD_PARTNER = new RegExp(`/partner/jobListing\\.htm\\?([^)${WS}]*)`, 'gu');
const GD_LISTING_ID = /(?:^|&)jobListingId=(\p{Nd}+)(?:&|$)/u;
const GD_JRTK = /(?:^|&)jrtk=[^&]*-([0-9a-f]{16})(?:&|$)/;

/** {Glassdoor job id: Indeed jk} from the partner links on the page (first link wins). */
export function glassdoorTwins(lines) {
  const twins = new Map();
  for (const line of lines) {
    for (const m of line.matchAll(GD_PARTNER)) {
      const jl = GD_LISTING_ID.exec(m[1]);
      const jk = GD_JRTK.exec(m[1]);
      if (jl && jk && !twins.has(jl[1])) twins.set(jl[1], jk[1]);
    }
  }
  return twins;
}

export function parseGlassdoor(md) {
  const lines = cleanLines(md);
  const twins = glassdoorTwins(lines);
  const rows = [];
  lines.forEach((line, i) => {
    const m = GD_LINK.exec(line);
    if (!m) return;
    let j = i - 1;
    let rating = null;
    if (j >= 0 && GD_RATING.test(lines[j])) {
      rating = pyFloat(lines[j]);
      j -= 1;
    }
    let company = j >= 0 ? lines[j] : null;
    if (company && company.endsWith(' Logo')) company = company.slice(0, -' Logo'.length); // company line missing, logo alt has the name
    if (company && (company.startsWith('[') || GD_LINK.test(company))) company = null;
    let k = i + 1;
    let location = k < lines.length ? lines[k] : null;
    if (location && (cpLen(location) > 60 || location.endsWith('\u{2026}') || location.endsWith('...') || GD_NOT_LOCATION.test(location))) {
      location = null; // missing: the next line is pay, a badge or the snippet
    } else {
      k += 1;
    }
    const pay = k < lines.length && GD_PAY.test(lines[k]) && cpLen(lines[k]) < 80 ? lines[k] : null;
    // '(Glassdoor est.)' is Glassdoor's guess at a full-time salary, not the intern pay, so it
    // gets no hourly number: it does not sort, filter or win a merge like employer pay.
    const estimate = pay !== null && pay.includes(GD_ESTIMATE);
    rows.push({
      source: 'glassdoor',
      title: strip(m.groups.title),
      company,
      location,
      pay,
      pay_hourly_min: estimate ? null : payHourlyMin(pay),
      rating,
      url: `${m.groups.url}?jl=${m.groups.id}`,
      job_id: m.groups.id,
      indeed_jk: twins.has(m.groups.id) ? twins.get(m.groups.id) : null,
    });
  });
  return rows;
}

export const PARSERS = { indeed: parseIndeed, glassdoor: parseGlassdoor };
