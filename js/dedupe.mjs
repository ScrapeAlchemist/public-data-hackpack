// Merge Indeed and Glassdoor rows into one list without duplicates. Port of python/dedupe.py:
// keep the two in sync, js/test.mjs compares them on every fixture.
//
// A Glassdoor row and an Indeed row are the same job when
//   1. the Glassdoor row's indeed_jk (from its partner link, see parsers.mjs) is the Indeed
//      row's job_id: an exact join that also works when the sites name the employer
//      differently ('IMC Trading' vs 'IMC Financial Markets'); or else
//   2. normCompany(company) + '|' + normTitle(title) match (the dedupe key).
// Location is not part of the key: one search covers one area, and the sites write the same
// place differently ('Hybrid work in San Francisco, CA' vs 'San Francisco, CA').
// Two rows from the same site are never merged unless they have the same job_id: apart from
// Indeed's repeated copy, which the parser already drops, a site does not list one job twice
// under two ids, so they are two jobs even when their keys match ('C++ Developer Intern' and
// 'C# Developer Intern' at one company).
//
// fold:          NFKD, remove accent marks U+0300..U+036F, lowercase. Both keys start with it.
// normCompany:   fold; drop (...) parts ('Mercor (Poland)' -> 'mercor');
//                '.com services' -> '.com'; drop '.com'; drop apostrophes; every run of
//                non [a-z0-9] -> one space; then drop trailing words in COMPANY_SUFFIXES while
//                more than one word is left.
// normTitle:     fold; drop a trailing country tag ('- US', ', USA', '(US)');
//                spell out 'c++', 'c#', 'f#', '.net' as 'cpp', 'csharp', 'fsharp', 'dotnet';
//                drop apostrophes; every run of non [a-z0-9] -> one space (so the words
//                inside (...) and [...] stay); drop season words and years (summer, 2027,
//                start); then the TITLE_SYNONYMS rewrites; collapse spaces.
//
// mergeRows:     rows in input order. A later row with the same (source, job_id) as an earlier
//                one is dropped. Then twins (rule 1) are paired: each Indeed row with at most
//                one Glassdoor row, the first in input order. Then groups form in order of
//                first appearance: a twin joins its partner's group; any other row joins the
//                first group with its key that has no row from its site and is not a twin
//                pair, or starts a new group. So a group holds at most one row per site.
//                title, company, location, rating: first non-null value in the group.
//                pay + pay_hourly_min: taken together from the row with the highest
//                pay_hourly_min (first one on a tie); if no row has pay_hourly_min, the first
//                non-null pay and pay_hourly_min = null. Glassdoor estimates have no
//                pay_hourly_min (see parsers.mjs), so employer pay always wins over them.
//                sources: in the fixed order indeed, glassdoor. urls: one per source.
//                key: the dedupe key of the group's first row. Two groups can share a key.
// sortRows:      pay_hourly_min descending, rows without it last; ties keep merge order.

import { WORD, WS, splitWords } from './compat.mjs';

export const SOURCE_ORDER = ['indeed', 'glassdoor'];
const COMPANY_SUFFIXES = new Set(['inc', 'llc', 'corp', 'corporation', 'co', 'ltd', 'usa', 'us']);
const SEASON_WORDS = /\b(?:summer|fall|autumn|winter|spring|start|20\d\d)\b/g; // runs on [a-z0-9 ] text only
const COUNTRY_TAG = new RegExp(
  `[${WS}]*(?:[\\-,|:\\u2013\\u2014][${WS}]*|[(\\[][${WS}]*)(?:us|usa|united states)[${WS}]*[)\\]]?[${WS}]*$`,
  'u',
);
const APOSTROPHES = /['\u{2019}]/gu;
const PARENS = /\([^)]*\)/g;
const COMBINING_MARKS = /[\u{300}-\u{36f}]/gu;
const COM_SERVICES = new RegExp(`\\.com[${WS}]+services(?!${WORD})`, 'gu');
const TITLE_SYNONYMS = [
  [/\bsoftware development engineer\b/g, 'software engineer'],
  [/\bengineering intern\b/g, 'engineer intern'],
];
// Names that punctuation removal would otherwise turn into 'c' or 'net'.
const PROTECTED_TOKENS = [
  [/(?<![a-z0-9])c\+\+/g, ' cpp '],
  [/(?<![a-z0-9])c#/g, ' csharp '],
  [/(?<![a-z0-9])f#/g, ' fsharp '],
  [/\.net(?![a-z0-9])/g, ' dotnet '],
];

/** NFKD, drop the accent marks it splits off ('Nestle' with an accent -> 'nestle'), lowercase. */
function fold(text) {
  return (text || '').normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
}

function words(text) {
  return text.replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normCompany(name) {
  let s = fold(name).replace(PARENS, ' ');
  s = s.replace(COM_SERVICES, '.com');
  s = s.replaceAll('.com', ' ');
  s = s.replace(APOSTROPHES, '');
  const w = splitWords(words(s));
  while (w.length > 1 && COMPANY_SUFFIXES.has(w[w.length - 1])) w.pop();
  return w.join(' ');
}

export function normTitle(title) {
  let s = fold(title).replace(COUNTRY_TAG, '');
  for (const [pattern, repl] of PROTECTED_TOKENS) s = s.replace(pattern, repl);
  s = words(s.replace(APOSTROPHES, '')); // from here on the text is plain [a-z0-9 ]
  s = s.replace(SEASON_WORDS, ' ');
  for (const [pattern, repl] of TITLE_SYNONYMS) s = s.replace(pattern, repl);
  return splitWords(s).join(' ');
}

export function dedupeKey(row) {
  return `${normCompany(row.company)}|${normTitle(row.title)}`;
}

/** Map {row index: partner row index} for Glassdoor rows whose indeed_jk is an Indeed job_id here. */
function twins(rows) {
  const indeedAt = new Map();
  rows.forEach((r, i) => {
    if (r.source === 'indeed' && !indeedAt.has(r.job_id)) indeedAt.set(r.job_id, i);
  });
  const twin = new Map();
  rows.forEach((r, i) => {
    if (r.source !== 'glassdoor' || r.indeed_jk === null || r.indeed_jk === undefined) return;
    const j = indeedAt.get(r.indeed_jk);
    if (j !== undefined && !twin.has(j)) { // one Glassdoor row per Indeed row, the first wins
      twin.set(i, j);
      twin.set(j, i);
    }
  });
  return twin;
}

export function mergeRows(rows) {
  const seenIds = new Set();
  const unique = [];
  for (const row of rows) {
    const ident = JSON.stringify([row.source, row.job_id]);
    if (seenIds.has(ident)) continue;
    seenIds.add(ident);
    unique.push(row);
  }

  const twin = twins(unique);
  const groups = []; // [[rows]] in order of first appearance
  const groupOf = new Map(); // row index -> group index
  const byKey = new Map(); // key -> indexes of groups that rows can still join by name
  unique.forEach((row, i) => {
    if (twin.has(i)) {
      let g;
      if (groupOf.has(twin.get(i))) { // the partner came first
        g = groupOf.get(twin.get(i));
        groups[g].push(row);
      } else { // a twin pair takes no other rows
        g = groups.length;
        groups.push([row]);
      }
      groupOf.set(i, g);
      return;
    }
    const key = dedupeKey(row);
    const open = byKey.get(key) || [];
    let g = open.find((k) => groups[k].every((r) => r.source !== row.source));
    if (g === undefined) {
      g = groups.length;
      groups.push([row]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(g);
    } else {
      groups[g].push(row);
    }
    groupOf.set(i, g);
  });

  const merged = [];
  for (const group of groups) {
    const key = dedupeKey(group[0]);
    const first = (field) => {
      const r = group.find((x) => x[field] !== null && x[field] !== undefined);
      return r ? r[field] : null;
    };
    const paid = group.filter((r) => r.pay_hourly_min !== null && r.pay_hourly_min !== undefined);
    let pay;
    let hourly;
    if (paid.length) {
      let best = paid[0];
      for (const r of paid) if (r.pay_hourly_min > best.pay_hourly_min) best = r; // first one wins ties
      pay = best.pay;
      hourly = best.pay_hourly_min;
    } else {
      pay = first('pay');
      hourly = null;
    }
    const urls = {};
    for (const r of group) if (!Object.hasOwn(urls, r.source)) urls[r.source] = r.url; // one row per source, so one url
    merged.push({
      title: first('title'),
      company: first('company'),
      location: first('location'),
      pay,
      pay_hourly_min: hourly,
      rating: first('rating'),
      sources: SOURCE_ORDER.filter((s) => Object.hasOwn(urls, s)),
      urls: Object.fromEntries(SOURCE_ORDER.filter((s) => Object.hasOwn(urls, s)).map((s) => [s, urls[s]])),
      key,
    });
  }
  return merged;
}

export function sortRows(merged) {
  const rank = (r) => (r.pay_hourly_min === null ? 1 : 0);
  // Array.prototype.sort is stable, like Python's sorted().
  return [...merged].sort((a, b) => rank(a) - rank(b) || (rank(a) ? 0 : b.pay_hourly_min - a.pay_hourly_min));
}

/** Case-insensitive substring filters; minHourly drops rows without a known hourly pay. */
export function filterRows(merged, titleIncludes = null, locationIncludes = null, minHourly = null) {
  return merged.filter((r) => {
    if (titleIncludes && !(r.title || '').toLowerCase().includes(titleIncludes.toLowerCase())) return false;
    if (locationIncludes && !(r.location || '').toLowerCase().includes(locationIncludes.toLowerCase())) return false;
    if (minHourly !== null && minHourly !== undefined && (r.pay_hourly_min === null || r.pay_hourly_min < minHourly)) return false;
    return true;
  });
}
