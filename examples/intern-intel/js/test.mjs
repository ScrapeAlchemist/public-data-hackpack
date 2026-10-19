// Parity tests: the JavaScript port must give exactly the output of the Python version.
//
// tests/make_golden.py runs the Python code on fixed inputs and writes tests/golden/*.json.
// This file runs the JavaScript code on the same inputs and compares, value by value and
// byte by byte (key order included). Run from js/:  npm test
// After a change to python/, regenerate the golden files first (see tests/make_golden.py).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { filterRows, mergeRows, normCompany, normTitle, sortRows } from './dedupe.mjs';
import { fetchOne, readText } from './fetch.mjs';
import {
  HELP, PROG, UsageError, asciiText, buildTable, compactPay, csvText, fetchRows, jsonText,
  parseArgs, run, tableLines,
} from './intern_intel.mjs';
import { PARSERS, cleanLines, indeedIsSpanish, parseGlassdoor, parseIndeed, payHourlyMin } from './parsers.mjs';
import {
  LookupError, glassdoorAutocompleteUrl, glassdoorUrl, indeedUrl, resolveGlassdoorLocation, slugify,
} from './sources.mjs';
import { floatRepr } from './compat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const golden = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'golden', name), 'utf8'));

/** Equal values with the same key order. JSON text shows both. */
function same(actual, expected, label) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);
}

/** Like Python's attempt(): the value, or {error} when the call throws. */
function attempt(fn, ...args) {
  try {
    return fn(...args);
  } catch (e) {
    return { error: e.name };
  }
}

/** A Python result that was an exception only needs a JS exception, not the same type name. */
function sameOrBothFail(actual, expected, label) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && 'error' in expected) {
    assert.ok(actual && typeof actual === 'object' && 'error' in actual, `${label}: Python raised ${expected.error}, JS did not`);
  } else {
    same(actual, expected, label);
  }
}

// Timings differ from run to run: '(fixture, 0.0 s)', 'FAILED after 0.0 s', 'in 0.1 s.'
const timeless = (text) => text.replace(/\d+\.\d s\b/g, 'T s');

// ---------------------------------------------------------------- parsers

test('parsers match Python on every fixture page', () => {
  for (const { file, source, rows } of golden('parse.json').fixtures) {
    same(PARSERS[source](readText(path.join(FIXTURES, file))), rows, file);
  }
});

test('parsers match Python on edited slices of the fixture pages', () => {
  for (const [i, c] of golden('windows.json').cases.entries()) {
    sameOrBothFail(attempt(parseIndeed, c.text), c.indeed, `window ${i} from ${c.from}, Indeed`);
    sameOrBothFail(attempt(parseGlassdoor, c.text), c.glassdoor, `window ${i} from ${c.from}, Glassdoor`);
  }
});

// ---------------------------------------------------------------- text helpers

test('text helpers match Python on hand-picked inputs', () => {
  const u = golden('units.json');
  for (const c of u.clean_lines) sameOrBothFail(attempt(cleanLines, c.in), c.out, `cleanLines ${JSON.stringify(c.in)}`);
  for (const c of u.pay_hourly_min) sameOrBothFail(attempt(payHourlyMin, c.in), c.out, `payHourlyMin ${JSON.stringify(c.in)}`);
  for (const c of u.norm_company) same(normCompany(c.in), c.out, `normCompany ${JSON.stringify(c.in)}`);
  for (const c of u.norm_title) same(normTitle(c.in), c.out, `normTitle ${JSON.stringify(c.in)}`);
  for (const c of u.slugify) same(slugify(c.in), c.out, `slugify ${JSON.stringify(c.in)}`);
  for (const c of u.compact_pay) same(compactPay(c.row), c.out, `compactPay ${JSON.stringify(c.row)}`);
  for (const c of u.ascii_text) same(asciiText(c.in), c.out, `asciiText ${JSON.stringify(c.in)}`);
  for (const c of u.indeed_is_spanish) {
    const text = c.file ? readText(path.join(FIXTURES, c.file)) : c.in;
    same(indeedIsSpanish(text), c.out, `indeedIsSpanish ${c.file || JSON.stringify(c.in)}`);
  }
});

test('text helpers match Python on seeded random strings', () => {
  for (const [i, c] of golden('fuzz.json').cases.entries()) {
    const label = (name) => `fuzz ${i} ${name} ${JSON.stringify(c.in)}`;
    sameOrBothFail(attempt(cleanLines, c.in), c.clean_lines, label('cleanLines'));
    sameOrBothFail(attempt(payHourlyMin, c.in), c.pay_hourly_min, label('payHourlyMin'));
    sameOrBothFail(attempt(normCompany, c.in), c.norm_company, label('normCompany'));
    sameOrBothFail(attempt(normTitle, c.in), c.norm_title, label('normTitle'));
    sameOrBothFail(attempt(slugify, c.in), c.slugify, label('slugify'));
    sameOrBothFail(attempt(asciiText, c.in), c.ascii_text, label('asciiText'));
    sameOrBothFail(attempt(compactPay, { pay: c.in, pay_hourly_min: c.hourly }), c.compact_pay, label('compactPay'));
    sameOrBothFail(attempt(indeedUrl, c.in, c.in, 1), c.indeed_url, label('indeedUrl'));
    sameOrBothFail(attempt(glassdoorAutocompleteUrl, c.in), c.autocomplete_url, label('autocompleteUrl'));
  }
});

// ---------------------------------------------------------------- URLs and locations

test('search URLs match Python', () => {
  const u = golden('units.json');
  for (const c of u.indeed_url) same(indeedUrl(...c.args), c.out, `indeedUrl ${JSON.stringify(c.args)}`);
  for (const c of u.glassdoor_url) same(glassdoorUrl(...c.args), c.out, `glassdoorUrl ${JSON.stringify(c.args)}`);
  for (const c of u.autocomplete_url) same(glassdoorAutocompleteUrl(c.in), c.out, `autocomplete ${JSON.stringify(c.in)}`);
});

test('Glassdoor location lookup matches Python', async () => {
  for (const c of golden('units.json').resolve) {
    const fetchRaw = c.response === null ? null : async () => c.response;
    const label = `resolve ${JSON.stringify(c.location)} with ${c.response}`;
    let out;
    try {
      out = await resolveGlassdoorLocation(c.location, fetchRaw);
    } catch (e) {
      assert.ok(e instanceof LookupError, `${label}: unexpected ${e.name}: ${e.message}`);
      out = { error: 'LookupError', message: e.message };
    }
    if (c.out.error === 'ValueError') {
      // Python raises json's ValueError here and the CLI prints its message; JS says the same in its own words.
      assert.equal(out.error, 'LookupError', label);
    } else {
      same(out, c.out, label);
    }
  }
});

// ---------------------------------------------------------------- merge, sort, filter, output text

function sameOutputs(rows, expected, label) {
  assert.equal(jsonText(rows), expected.json_text, `${label}: json text`);
  assert.equal(jsonText(rows), expected.json_file, `${label}: json file`);
  assert.equal(csvText(rows), expected.csv_text, `${label}: csv text`);
  assert.equal(tableLines(rows).map((l) => `${l}\n`).join(''), expected.table, `${label}: table`);
}

test('merge, sort, filter and the output files match Python', () => {
  const u = golden('units.json');
  const merged = mergeRows(u.merge.rows);
  same(merged, u.merge.merged, 'merged');
  same(sortRows(merged), u.merge.sorted, 'sorted');
  for (const f of u.merge.filtered) same(sortRows(filterRows(merged, ...f.args)), f.out, `filter ${JSON.stringify(f.args)}`);
  sameOutputs(sortRows(merged), u.merge.outputs, 'synthetic rows');
  for (const c of u.merge_all) {
    const m = sortRows(mergeRows(c.rows));
    same(m, c.sorted, `all fixture rows, ${c.name}`);
    sameOutputs(m, c.outputs, `all fixture rows, ${c.name}`);
  }
  sameOutputs([], u.empty_outputs, 'no rows');
});

// ---------------------------------------------------------------- whole runs

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'intern-intel-'));
}

test('whole CLI runs match Python: printed text, out/intern_intel.json, out/intern_intel.csv', async () => {
  for (const c of golden('pipeline.json').cases) {
    const dir = tempDir();
    const outDir = tempDir();
    try {
      for (const [src, dest] of c.files) fs.copyFileSync(path.join(FIXTURES, src), path.join(dir, dest));
      const argv = c.argv.map((a) => a.replaceAll('{dir}', dir));
      const lines = [];
      const print = (line = '') => lines.push(`${line}\n`);
      const code = await run(parseArgs(argv), { print, outDir });
      assert.equal(code, c.exit, `${c.name}: exit code`);
      assert.equal(timeless(lines.join('').replaceAll(dir, '{dir}')), timeless(c.stdout), `${c.name}: printed text`);
      for (const [name, expected] of [['intern_intel.json', c.out_json], ['intern_intel.csv', c.out_csv]]) {
        const file = path.join(outDir, name);
        const actual = fs.existsSync(file) ? readText(file) : null;
        assert.equal(actual, expected, `${c.name}: ${name}`);
      }
      if (c.plan) {
        const args = parseArgs(argv);
        const [plan, , allRows] = await fetchRows(args, () => {});
        const [merged, rows] = buildTable(allRows, args);
        same(plan.map(([s, n, u]) => [s, n, u.replaceAll(dir, '{dir}').replaceAll('\\', '/')]), c.plan, `${c.name}: plan`);
        same(allRows, c.all_rows, `${c.name}: rows from all pages`);
        same(merged, c.merged, `${c.name}: merged`);
        same(rows, c.rows, `${c.name}: final rows`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});

test('offline runs write exactly fixtures/expected/*.json', async () => {
  const cases = {
    sf_swe_p2: ['--offline', '--pages', '2'],
    ny_ds_p1: ['--offline', '--role', 'data science intern', '--location', 'New York, NY'],
    remote_swe_p1: ['--offline', '--location', 'Remote'],
  };
  for (const [name, argv] of Object.entries(cases)) {
    const args = parseArgs(argv);
    const [, , allRows] = await fetchRows(args, () => {});
    const [, rows] = buildTable(allRows, args);
    assert.equal(jsonText(rows), readText(path.join(FIXTURES, 'expected', `${name}.json`)), name);
  }
});

test('saved pages read with --from-dir write exactly fixtures/expected/*.json', async () => {
  const cases = {
    chicago_swe_p1: [['chicago_swe_indeed_p1.md', 'indeed_p1.md'], ['chicago_swe_glassdoor_p1.md', 'glassdoor_p1.md']],
    ny_ds_es_p1: [['ny_ds_es_indeed_p1.md', 'indeed_p1.md'], ['ny_ds_glassdoor_p1.md', 'glassdoor_p1.md']],
  };
  for (const [name, files] of Object.entries(cases)) {
    const dir = tempDir();
    try {
      for (const [src, dest] of files) fs.copyFileSync(path.join(FIXTURES, src), path.join(dir, dest));
      const args = parseArgs(['--from-dir', dir]);
      const [, , allRows] = await fetchRows(args, () => {});
      const [, rows] = buildTable(allRows, args);
      assert.equal(jsonText(rows), readText(path.join(FIXTURES, 'expected', `${name}.json`)), name);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('offline mode has no page for an unknown URL', async () => {
  const page = await fetchOne('https://www.indeed.com/jobs?q=nothing&l=nowhere', { offline: true });
  assert.equal(page.ok, false);
  assert.match(page.error, /^no fixture for this URL/);
});

// ---------------------------------------------------------------- command line

const SNAKE = {
  role: 'role', location: 'location', pages: 'pages', titleIncludes: 'title_includes',
  locationIncludes: 'location_includes', minHourly: 'min_hourly', limit: 'limit', refresh: 'refresh',
  offline: 'offline', saveFixtures: 'save_fixtures', printUrls: 'print_urls', fromDir: 'from_dir',
};

test('command lines are accepted and rejected like Python argparse', () => {
  for (const c of golden('argv.json').cases) {
    const label = `argv ${JSON.stringify(c.argv)}`;
    let args;
    try {
      args = parseArgs(c.argv);
    } catch (e) {
      assert.ok(e instanceof UsageError, `${label}: ${e}`);
      assert.equal(e.exitCode, c.exit, `${label}: exit code (${e.message.slice(0, 80)})`);
      if (c.exit === 0) {
        // Same help text; only the program name differs, and the usage lines indent one more space.
        const expected = c.help.replaceAll('intern_intel.py', PROG).replace(/^( {23})\[/gm, ' $1[');
        assert.equal(e.message, expected, label);
        assert.equal(e.message, HELP, label);
      } else {
        assert.equal(e.message, c.error, label);
      }
      continue;
    }
    assert.equal(c.exit, undefined, `${label}: Python exits with ${c.exit}: ${c.error}`);
    const shown = Object.fromEntries(Object.entries(args).map(([k, v]) => [SNAKE[k],
      typeof v === 'number' && k === 'minHourly' ? { float: floatRepr(v) } : v]));
    same(shown, c.args, label);
  }
});
