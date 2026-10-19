// Intern Intel: internship listings from Indeed and Glassdoor, merged into one table.
// JavaScript port of python/intern_intel.py: same flags, same printed table, same out/ files.
//
//   node js/intern_intel.mjs                                   # software engineer intern, San Francisco, CA
//   node js/intern_intel.mjs --role "data science intern" --location "New York, NY"
//   node js/intern_intel.mjs --pages 2 --min-hourly 40
//   node js/intern_intel.mjs --offline                         # no network and no API key: reads fixtures/
//   node js/intern_intel.mjs --print-urls                      # only print the search URLs
//   node js/intern_intel.mjs --from-dir cache/cli/my-search    # parse pages fetched by another tool
//
// Steps: build URLs -> fetch markdown through Bright Data (cached) -> parse each site ->
// merge and remove duplicates -> filter -> sort by hourly pay -> print, and write
// out/intern_intel.csv and out/intern_intel.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { csvRow, fixed0, fixed1, floatRepr, pyJsonDumps, pyRepr, strip } from './compat.mjs';
import { SOURCE_ORDER, filterRows, mergeRows, sortRows } from './dedupe.mjs';
import { FIXTURES_DIR, Page, REPO_ROOT, fetchMany, fetchOne, readText, writeText } from './fetch.mjs';
import { PARSERS, indeedIsSpanish } from './parsers.mjs';
import { LookupError, MAX_PAGES, glassdoorUrl, indeedUrl, resolveGlassdoorLocation } from './sources.mjs';

export const OUT_DIR = path.join(REPO_ROOT, 'out');
const CSV_FIELDS = ['title', 'company', 'location', 'pay', 'pay_hourly_min', 'rating', 'sources',
  'indeed_url', 'glassdoor_url', 'key'];

const defaultPrint = (line = '') => process.stdout.write(`${line}\n`);

// ---------------------------------------------------------------- arguments
// A small copy of Python's argparse rules, so both versions accept and reject the same
// command lines: '--flag value' or '--flag=value', unique prefixes ('--min' = '--min-hourly'),
// exit code 2 with a usage message on a bad argument.

export const PROG = 'intern_intel.mjs';
export const USAGE = `usage: ${PROG} [-h] [--role ROLE] [--location LOCATION]
                        [--pages {1,2}] [--title-includes TITLE_INCLUDES]
                        [--location-includes LOCATION_INCLUDES]
                        [--min-hourly MIN_HOURLY] [--limit LIMIT] [--refresh]
                        [--offline] [--save-fixtures [PREFIX]] [--print-urls]
                        [--from-dir DIR]
`;
export const HELP = `${USAGE}
Internship listings from Indeed and Glassdoor in one table.

options:
  -h, --help            show this help message and exit
  --role ROLE           search keywords
  --location LOCATION   e.g. "New York, NY" or "Remote"; empty = whole US
  --pages {1,2}         1 = top results per site, 2 = also the newest listings
                        per site
  --title-includes TITLE_INCLUDES
                        keep rows whose title contains this text
  --location-includes LOCATION_INCLUDES
                        keep rows whose location contains this text
  --min-hourly MIN_HOURLY
                        keep rows paying at least this many USD per hour
  --limit LIMIT         print only the first N rows (files get all rows)
  --refresh             ignore the 6-hour cache and fetch again
  --offline             read pages from fixtures/ only (no network, no API
                        key)
  --save-fixtures [PREFIX]
                        copy the fetched pages into fixtures/ as
                        <PREFIX><source>_p<page>.md
  --print-urls          print the search URLs (source, page, url; tab
                        separated) and exit
  --from-dir DIR        parse markdown files already in DIR (indeed_p1.md,
                        glassdoor_p1.md, ...) instead of fetching; --role,
                        --location and --pages are then not used
`;

/** A bad command line (exitCode 2), or --help (exitCode 0, message = the help text). */
export class UsageError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = exitCode;
  }
}

const OPTIONS = [
  { strings: ['-h', '--help'], dest: 'help', nargs: 0 },
  { strings: ['--role'], dest: 'role', nargs: 1, default: 'software engineer intern' },
  { strings: ['--location'], dest: 'location', nargs: 1, default: 'San Francisco, CA' },
  { strings: ['--pages'], dest: 'pages', nargs: 1, type: 'int', default: 1, choices: Array.from({ length: MAX_PAGES }, (_, i) => i + 1) },
  { strings: ['--title-includes'], dest: 'titleIncludes', nargs: 1, default: null },
  { strings: ['--location-includes'], dest: 'locationIncludes', nargs: 1, default: null },
  { strings: ['--min-hourly'], dest: 'minHourly', nargs: 1, type: 'float', default: null },
  { strings: ['--limit'], dest: 'limit', nargs: 1, type: 'int', default: null },
  { strings: ['--refresh'], dest: 'refresh', nargs: 0, default: false },
  { strings: ['--offline'], dest: 'offline', nargs: 0, default: false },
  { strings: ['--save-fixtures'], dest: 'saveFixtures', nargs: '?', const: '', default: null },
  { strings: ['--print-urls'], dest: 'printUrls', nargs: 0, default: false },
  { strings: ['--from-dir'], dest: 'fromDir', nargs: 1, default: null },
];
const BY_STRING = new Map(OPTIONS.flatMap((o) => o.strings.map((s) => [s, o])));
const NEGATIVE_NUMBER = /^-\p{Nd}+$|^-\p{Nd}*\.\p{Nd}+$/u;
const ND = /\p{Nd}/u;

/** Unicode digits -> ASCII digits, as Python's int() and float() read them. */
function asciiDigits(s) {
  let out = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (ND.test(ch)) {
      let start = ch.codePointAt(0);
      while (ND.test(String.fromCodePoint(start - 1))) start--;
      out += String((ch.codePointAt(0) - start) % 10);
    } else out += ch;
  }
  return out;
}

/** Python int(text): surrounding whitespace, a sign, '_' between digits, any Unicode digits. */
function pyInt(text) {
  const s = asciiDigits(strip(text));
  if (!/^[+-]?[0-9]+(?:_[0-9]+)*$/.test(s)) return null;
  return Number(s.replaceAll('_', ''));
}

/** Python float(text), including 'inf', 'nan' and '1_000.5'. */
function pyFloatArg(text) {
  const s = asciiDigits(strip(text));
  const word = /^([+-]?)(inf|infinity|nan)$/i.exec(s);
  if (word) {
    if (word[2].toLowerCase() === 'nan') return NaN;
    return word[1] === '-' ? -Infinity : Infinity;
  }
  const digits = '[0-9](?:_?[0-9])*';
  const ok = new RegExp(`^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`);
  if (!ok.test(s)) return null;
  return Number(s.replaceAll('_', ''));
}

/** The option an argument names: {spec, str, explicit}, or null for a plain value. */
function parseOptional(arg) {
  if (!arg || arg[0] !== '-') return null;
  if (BY_STRING.has(arg)) return [{ spec: BY_STRING.get(arg), str: arg, explicit: null }];
  if (arg.length === 1) return null;
  const eq = arg.indexOf('=');
  if (eq >= 0 && BY_STRING.has(arg.slice(0, eq))) {
    return [{ spec: BY_STRING.get(arg.slice(0, eq)), str: arg.slice(0, eq), explicit: arg.slice(eq + 1), sep: '=' }];
  }
  const tuples = [];
  if (arg[1] === '-') {
    const prefix = eq >= 0 ? arg.slice(0, eq) : arg;
    const explicit = eq >= 0 ? arg.slice(eq + 1) : null;
    for (const [s, spec] of BY_STRING) if (s.startsWith(prefix)) tuples.push({ spec, str: s, explicit, sep: eq >= 0 ? '=' : null });
  } else {
    for (const [s, spec] of BY_STRING) {
      if (s === arg.slice(0, 2)) tuples.push({ spec, str: s, explicit: arg.slice(2), sep: '' });
      else if (s.startsWith(arg)) tuples.push({ spec, str: s, explicit: null, sep: null });
    }
  }
  if (tuples.length) return tuples;
  if (NEGATIVE_NUMBER.test(arg)) return null;
  if (arg.includes(' ')) return null;
  return [{ spec: null, str: arg, explicit: null }];
}

function convert(spec, value) {
  let v = value;
  if (spec.type === 'int' || spec.type === 'float') {
    v = spec.type === 'int' ? pyInt(value) : pyFloatArg(value);
    if (v === null) throw new UsageError(`argument ${spec.strings.join('/')}: invalid ${spec.type} value: ${pyRepr(value)}`);
  }
  if (spec.choices && !spec.choices.includes(v)) {
    const shown = spec.type === 'float' ? floatRepr(v) : String(v);
    throw new UsageError(`argument ${spec.strings.join('/')}: invalid choice: ${pyRepr(shown)} ` +
      `(choose from ${spec.choices.join(', ')})`);
  }
  return v;
}

/** Parse the command line like python/intern_intel.py does. Throws UsageError. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = Object.fromEntries(OPTIONS.filter((o) => o.dest !== 'help').map((o) => [o.dest, o.default]));
  const kinds = []; // 'O' option, 'A' value, '-' for '--'
  const optionAt = new Map();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') {
      kinds.push('-');
      for (i++; i < argv.length; i++) kinds.push('A');
      break;
    }
    const tuples = parseOptional(argv[i]);
    if (tuples) optionAt.set(i, tuples);
    kinds.push(tuples ? 'O' : 'A');
  }
  const extras = [];
  let i = 0;
  while (i < argv.length) {
    if (kinds[i] === '-') {
      extras.push(...argv.slice(i));
      break;
    }
    if (kinds[i] !== 'O') {
      extras.push(argv[i]);
      i++;
      continue;
    }
    const tuples = optionAt.get(i);
    if (tuples.length > 1) {
      throw new UsageError(`ambiguous option: ${argv[i]} could match ${tuples.map((t) => t.str).join(', ')}`);
    }
    const { spec, explicit, sep } = tuples[0];
    if (!spec) {
      extras.push(argv[i]);
      i++;
      continue;
    }
    const name = spec.strings.join('/');
    if (spec.nargs === 0) {
      if (explicit !== null && explicit !== undefined) {
        // '-hx' is '-h' followed by '-x'; anything else attached to a flag is an error.
        if (!(tuples[0].str[1] !== '-' && explicit !== '' && !sep && explicit[0] !== '-')) {
          throw new UsageError(`argument ${name}: ignored explicit argument ${pyRepr(explicit)}`);
        }
      }
      if (spec.dest === 'help') throw new UsageError(HELP, 0);
      args[spec.dest] = true;
      i++;
      continue;
    }
    if (explicit !== null && explicit !== undefined) {
      args[spec.dest] = convert(spec, explicit);
      i++;
      continue;
    }
    if (i + 1 < argv.length && kinds[i + 1] === 'A') {
      args[spec.dest] = convert(spec, argv[i + 1]);
      i += 2;
      continue;
    }
    if (spec.nargs === '?') {
      args[spec.dest] = spec.const;
      i++;
      continue;
    }
    throw new UsageError(`argument ${name}: expected one argument`);
  }
  if (extras.length) throw new UsageError(`unrecognized arguments: ${extras.join(' ')}`);
  if (args.fromDir && (args.offline || args.refresh || args.printUrls || args.saveFixtures !== null)) {
    throw new UsageError('--from-dir reads files you already have, so it does not combine with ' +
      '--offline, --refresh, --print-urls or --save-fixtures');
  }
  return args;
}

// ---------------------------------------------------------------- URLs and pages

/** [[source, page, url]] in a fixed order: Indeed pages, then Glassdoor pages. */
export async function planUrls(args, print = defaultPrint) {
  const pageNumbers = Array.from({ length: args.pages }, (_, i) => i + 1);
  const plan = pageNumbers.map((n) => ['indeed', n, indeedUrl(args.role, args.location, n)]);

  const fetchRaw = async (url) => {
    const page = await fetchOne(url, { markdown: false, refresh: args.refresh, offline: args.offline });
    if (!page.ok) throw new LookupError(page.error);
    return page.text;
  };

  let locType;
  let locId;
  try {
    [locType, locId] = await resolveGlassdoorLocation(args.location, fetchRaw);
  } catch (e) {
    if (!(e instanceof LookupError || e instanceof RangeError)) throw e;
    print(`[glassdoor] skipped: location lookup failed (${e.message})`);
    return plan;
  }
  for (const n of pageNumbers) plan.push(['glassdoor', n, glassdoorUrl(args.role, args.location, locType, locId, n)]);
  return plan;
}

const DIR_FILE = /^(indeed|glassdoor)(?:_p(\p{Nd}+))?\.md\n?$/u;

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function codePointCompare(a, b) {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return x[k] - y[k];
  return x.length - y.length;
}

/**
 * Read saved search pages from a folder. Returns [plan, pages] like the fetch step does.
 *
 * File names: indeed_p1.md, indeed_p2.md, glassdoor_p1.md, glassdoor_p2.md ('indeed.md'
 * counts as page 1). Other files are ignored. The order is Indeed pages, then Glassdoor
 * pages, the same order a normal run uses, so both give the same table.
 */
export function pagesFromDir(directory) {
  const found = [];
  for (const name of fs.readdirSync(directory)) {
    const m = DIR_FILE.exec(name);
    const full = path.join(directory, name);
    if (m && isFile(full)) {
      found.push({ order: SOURCE_ORDER.indexOf(m[1]), n: m[2] ? pyInt(m[2]) : 1, name, source: m[1], full });
    }
  }
  found.sort((a, b) => a.order - b.order || a.n - b.n || codePointCompare(a.name, b.name));
  const plan = found.map((f) => [f.source, f.n, f.full]);
  const pages = found.map((f) => new Page(f.full, { text: readText(f.full), origin: `file ${f.name}` }));
  return [plan, pages];
}

// ---------------------------------------------------------------- display

const NON_ASCII = /[^\x00-\x7f]/g;

export function asciiText(s) {
  s = (s || '').replaceAll('\u{2013}', '-').replaceAll('\u{2014}', '-').replaceAll('\u{2019}', "'").replaceAll('\u{2026}', '...');
  return s.normalize('NFKD').replace(NON_ASCII, '');
}

const PAY_SHORT = [[' (Employer provided)', ''], [' (Glassdoor est.)', ' est.'], [' an hour', '/hr'],
  [' Per Hour', '/hr'], [' a year', '/yr'], [' a month', '/mo'], [' a week', '/wk'], [' a day', '/day']];

export function compactPay(row) {
  let pay = row.pay;
  if (!pay) return '-';
  for (const [oldText, newText] of PAY_SHORT) pay = pay.replaceAll(oldText, newText);
  if (row.pay_hourly_min !== null && row.pay_hourly_min !== undefined && !pay.includes('/hr')) {
    pay += ` (~$${fixed0(row.pay_hourly_min)}/hr)`;
  }
  return pay;
}

const COLUMNS = [['Title', 46], ['Company', 22], ['Location', 26], ['Pay', 34], ['Rating', 6], ['Sources', 16]];

function cell(text, width) {
  text = asciiText(text);
  return text.length <= width ? text.padEnd(width) : `${text.slice(0, width - 3)}...`;
}

/** The printed table, one string per line. */
export function tableLines(rows) {
  const lines = [
    COLUMNS.map(([name, w]) => cell(name, w)).join(' | '),
    COLUMNS.map(([, w]) => '-'.repeat(w)).join('-+-'),
  ];
  for (const r of rows) {
    const values = [r.title, r.company || '-', r.location || '-', compactPay(r),
      r.rating !== null && r.rating !== undefined ? fixed1(r.rating) : '-', r.sources.join('+')];
    lines.push(values.map((v, k) => cell(v, COLUMNS[k][1])).join(' | '));
  }
  return lines;
}

export function printTable(rows, print = defaultPrint) {
  for (const line of tableLines(rows)) print(line);
}

// ---------------------------------------------------------------- files

/** The exact text of out/intern_intel.json. fixtures/expected/*.json hold this for the sample pages. */
export function jsonText(rows) {
  // Whole numbers print as 62, not 62.0, the same as the Python version's plain_number().
  return `${pyJsonDumps(rows, { ensureAscii: false })}\n`;
}

export function csvText(rows) {
  let text = csvRow(CSV_FIELDS);
  for (const r of rows) {
    text += csvRow([r.title, r.company, r.location, r.pay, r.pay_hourly_min ?? '', r.rating ?? '',
      r.sources.join('|'), r.urls.indeed ?? '', r.urls.glassdoor ?? '', r.key]);
  }
  return text;
}

export function writeOutputs(rows, outDir = OUT_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'intern_intel.json'), jsonText(rows), 'utf8');
  fs.writeFileSync(path.join(outDir, 'intern_intel.csv'), csvText(rows), 'utf8');
}

function localDate() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function saveFixtures(plan, pages, prefix, print = defaultPrint) {
  const manifestPath = path.join(FIXTURES_DIR, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(readText(manifestPath)) : { pages: {} };
  plan.forEach(([source, n, url], k) => {
    const page = pages[k];
    if (page.ok && page.origin !== 'fixture') {
      const name = `${prefix}${source}_p${n}.md`;
      writeText(path.resolve(FIXTURES_DIR, name), page.text);
      manifest.pages[url] = { file: name, source, page: n, fetched: localDate() };
      print(`[fixtures] saved ${name}`);
    }
  });
  writeText(manifestPath, `${pyJsonDumps(manifest)}\n`);
}

// ---------------------------------------------------------------- main

/** Indeed sometimes sends its US search page in Spanish. Fetch such a page once more, without the cache. */
async function refetchSpanish(plan, pages, print) {
  for (let k = 0; k < plan.length; k++) {
    const [source, n, url] = plan[k];
    const page = pages[k];
    if (source === 'indeed' && page.ok && indeedIsSpanish(page.text)) {
      print(`[indeed p${n}] the page came back in Spanish, fetching it once more`);
      const again = await fetchOne(url, { refresh: true });
      if (again.ok) {
        again.seconds = Number(fixed1(page.seconds + again.seconds));
        pages[k] = again;
      }
    }
  }
}

/** Fetch every planned page and parse it. Returns [plan, pages, rows from all pages]. */
export async function fetchRows(args, print = defaultPrint) {
  let plan;
  let pages;
  if (args.fromDir) {
    [plan, pages] = pagesFromDir(args.fromDir);
  } else {
    plan = await planUrls(args, print);
    pages = await fetchMany(plan.map(([, , url]) => url), { refresh: args.refresh, offline: args.offline });
    if (!args.offline) await refetchSpanish(plan, pages, print);
  }
  const allRows = [];
  plan.forEach(([source, n], k) => {
    const page = pages[k];
    if (!page.ok) {
      print(`[${source} p${n}] FAILED after ${floatRepr(page.seconds)} s: ${page.error}`);
      return;
    }
    const rows = PARSERS[source](page.text);
    allRows.push(...rows);
    print(`[${source} p${n}] ${String(rows.length).padStart(2)} listings  (${page.origin}, ${floatRepr(page.seconds)} s)`);
    if (source === 'indeed' && indeedIsSpanish(page.text)) {
      print(`[indeed p${n}] warning: this page is in Spanish. Its rows are parsed, but check them.`);
    }
  });
  return [plan, pages, allRows];
}

/** Merge, filter and sort. Returns [merged before filters, final rows]. */
export function buildTable(allRows, args) {
  const merged = mergeRows(allRows);
  const rows = sortRows(filterRows(merged, args.titleIncludes, args.locationIncludes, args.minHourly));
  return [merged, rows];
}

export async function run(args, { print = defaultPrint, outDir = OUT_DIR } = {}) {
  const t0 = performance.now();
  if (args.printUrls) {
    for (const [source, n, url] of await planUrls(args, print)) print(`${source}\t${n}\t${url}`);
    return 0;
  }
  if (args.fromDir && !isDir(args.fromDir)) {
    print(`No such folder: ${args.fromDir}`);
    return 1;
  }
  const [plan, pages, allRows] = await fetchRows(args, print);
  if (args.saveFixtures !== null) saveFixtures(plan, pages, args.saveFixtures, print);
  if (!pages.some((p) => p.ok)) {
    if (args.fromDir) print(`No indeed_p<N>.md or glassdoor_p<N>.md files in ${args.fromDir}.`);
    else if (args.offline) print('No saved pages for this search. fixtures/manifest.json lists the saved ones.');
    else print('Nothing fetched. Try again, or run with --offline to use the saved sample pages.');
    return 1;
  }

  const [merged, rows] = buildTable(allRows, args);
  const both = merged.filter((r) => r.sources.length > 1).length;
  print();
  printTable(args.limit ? rows.slice(0, args.limit) : rows, print);
  writeOutputs(rows, outDir);
  print();
  print(`${allRows.length} listings -> ${merged.length} unique jobs (${both} on both sites)` +
    ` -> ${rows.length} after filters. Wrote out/intern_intel.csv and out/intern_intel.json` +
    ` in ${fixed1((performance.now() - t0) / 1000)} s.`);
  return 0;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (e.exitCode === 0) process.stdout.write(e.message);
    else process.stderr.write(`${USAGE}${PROG}: error: ${e.message}\n`);
    process.exitCode = e.exitCode;
    return;
  }
  process.exitCode = await run(args);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const a = fs.realpathSync(process.argv[1]);
    const b = fs.realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isMainModule()) await main();
