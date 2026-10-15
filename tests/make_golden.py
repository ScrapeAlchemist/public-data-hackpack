"""Write tests/golden/*.json from the Python implementation.

js/test.mjs runs the JavaScript port on the same inputs and checks that it gives exactly
these outputs. Run this again after any change to python/ and commit the result:

    .venv\\Scripts\\python tests\\make_golden.py      (Windows)
    .venv/bin/python tests/make_golden.py          (macOS, Linux)

Nothing here touches the network: every pipeline case runs with --offline, --from-dir or
--print-urls on a location that needs no lookup.

Files:
  parse.json     every fixture page through both parsers
  windows.json   random slices of the fixture pages with random edits, through both parsers
  units.json     text helpers, URLs, location lookup, merge/sort/filter, table, JSON and CSV text
  fuzz.json      seeded random strings through every text helper
  pipeline.json  whole CLI runs: printed text, out/intern_intel.json and out/intern_intel.csv
  argv.json      command lines through the argument parser
"""

import contextlib
import io
import json
import os
import random
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
os.environ["COLUMNS"] = "80"  # argparse wraps --help to the terminal width
sys.argv[0] = "intern_intel.py"  # argparse prints this name in usage and errors

import dedupe  # noqa: E402
import intern_intel  # noqa: E402
import parsers  # noqa: E402
import sources  # noqa: E402

GOLDEN = ROOT / "tests" / "golden"
FIXTURES = ROOT / "fixtures"
SEED = 20261015


def write(name, data):
    GOLDEN.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, indent=1, ensure_ascii=True, allow_nan=False) + "\n"
    (GOLDEN / name).write_text(text, encoding="ascii", newline="\n")
    print(f"wrote tests/golden/{name} ({len(text) // 1024} KB)")


def attempt(fn, *args):
    """fn(*args), or {"error": <exception name>} when Python raises."""
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001 - the JS side must fail on the same inputs
        return {"error": type(e).__name__}


def fixture_pages():
    """[(path relative to fixtures/, source)] for every saved search page."""
    out = []
    for path in sorted(FIXTURES.rglob("*.md")):
        rel = path.relative_to(FIXTURES).as_posix()
        source = "indeed" if "indeed" in path.name else "glassdoor"
        out.append((rel, source))
    return out


# ---------------------------------------------------------------- palette for random text

C = chr
PALETTE = [
    # whitespace and line breaks, ASCII and Unicode (Python's str.isspace() set and a few that are not in it)
    " ", "  ", "\t", "\n", "\r\n", "\r", C(0x0B), C(0x0C), C(0x1C), C(0x1D), C(0x1E), C(0x1F), C(0x85),
    C(0xA0), C(0x1680), C(0x2000), C(0x2009), C(0x200B), C(0x2028), C(0x2029), C(0x202F), C(0x205F),
    C(0x3000), C(0xFEFF), C(0x00),
    # digits: ASCII, Arabic-Indic, Devanagari, fullwidth, math double-struck, superscript, circled
    "0", "7", "42", "1,000", "2027", "12.5", C(0x663), C(0x664) + "." + C(0x663), C(0x966), C(0xFF13),
    C(0x1D7D9), C(0xB2), C(0x2460),
    # punctuation and markdown
    "$", "$ ", "K", "k", ".", ",", "-", " - ", C(0x2013), C(0x2014), C(0x2019), "'", '"', C(0x2026), "...",
    "|", ":", "(", ")", "[", "]", "!", "#", "*", "_", "\\", "&", ";", "~", "`", "{", "}", "+", "<", ">", "/",
    "?", "=", "%", "@",
    "&amp;", "&hellip;", "&#8217;", "&#x2019;", "&nbsp;", "&bogus;", "&#38;", "&lt;", "&#65;", "&#X41;",
    "&#0;", "&#x1F600;",
    "**", "### ", "*   ", "+ ", "- ", "![logo](x.png)", "![Company Logo](https://x/y.png)", "\\&", "\\_",
    "\\[", "\\(", "\\\\",
    # pay words
    " an hour", " a year", " a month", " a week", " a day", " Per Hour", "/hr", "/yr", "/mo", "/wk", "day",
    "today", "Monday", "day_", "hourly", "annual", "Up to ", "up to ", "From ", " (Employer provided)",
    " (Glassdoor est.)",
    # title and company words
    "(US)", " - US", ", USA", " | United States", "[us]", " (us)", "summer", "Summer", "fall", "start", "2026",
    "intern", "Intern", "Software Development Engineer", "Engineering Intern", "Inc.", " Inc", " LLC", " Corp",
    " co", ".com", ".COM Services", " Services", "Amazon.com Services LLC", "Mercor (Poland)",
    # letters that change under NFKD or lowercasing
    "caf" + C(0xE9), "cafe" + C(0x301), C(0xC9), C(0xF1), C(0xFC), C(0xFB01), C(0x130), C(0xDF), C(0x1E9E),
    C(0x3A3), C(0x3C3), C(0x39F) + C(0x3A3), C(0x391) + C(0x3A3) + " ", C(0x212A), C(0x2126), C(0xC5),
    C(0x131), C(0x1F600), C(0x10400), C(0x4E2D) + C(0x6587), C(0x627) + C(0x644), C(0x5D0),
]


def random_text(rng, max_parts=12):
    return "".join(rng.choice(PALETTE) for _ in range(rng.randint(1, max_parts)))


# ---------------------------------------------------------------- parse.json and windows.json

def make_parse():
    out = []
    for rel, source in fixture_pages():
        text = (FIXTURES / rel).read_bytes().decode("utf-8")
        out.append({"file": rel, "source": source, "rows": parsers.PARSERS[source](text)})
    write("parse.json", {"fixtures": out})


def mutate(rng, lines):
    out = []
    for line in lines:
        r = rng.random()
        if r < 0.05:
            continue  # drop the line
        if r < 0.10:
            out += [line, line]  # duplicate it
            continue
        if r < 0.22:
            i = rng.randint(0, len(line))
            line = line[:i] + random_text(rng, 3) + line[i:]
        elif r < 0.28 and line:
            i = rng.randint(0, len(line) - 1)
            line = line[:i] + line[i + rng.randint(1, 8):]
        out.append(line)
    if len(out) > 2 and rng.random() < 0.5:
        i = rng.randint(0, len(out) - 2)
        out[i], out[i + 1] = out[i + 1], out[i]
    return out


def make_windows():
    rng = random.Random(SEED)
    cases = []
    for rel, _ in fixture_pages():
        lines = (FIXTURES / rel).read_bytes().decode("utf-8").splitlines(keepends=True)
        for _ in range(12):
            size = rng.randint(15, 60)
            start = rng.randint(0, max(0, len(lines) - size))
            window = lines[start:start + size]
            text = "".join(mutate(rng, window) if rng.random() < 0.8 else window)
            cases.append({
                "from": rel,
                "text": text,
                "indeed": attempt(parsers.parse_indeed, text),
                "glassdoor": attempt(parsers.parse_glassdoor, text),
            })
    write("windows.json", {"cases": cases})


# ---------------------------------------------------------------- units.json

def capture(fn, *args):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*args)
    return buf.getvalue()


def outputs_for(rows):
    """json_text, csv text and printed table for rows that have been through merge_rows."""
    with tempfile.TemporaryDirectory() as tmp:
        saved = intern_intel.OUT_DIR
        intern_intel.OUT_DIR = Path(tmp)
        try:
            intern_intel.write_outputs(rows)
            csv_text = (Path(tmp) / "intern_intel.csv").read_bytes().decode("utf-8")
            json_file = (Path(tmp) / "intern_intel.json").read_bytes().decode("utf-8")
        finally:
            intern_intel.OUT_DIR = saved
    return {
        "json_text": intern_intel.json_text(rows),
        "json_file": json_file,
        "csv_text": csv_text,
        "table": capture(intern_intel.print_table, rows),
    }


def row(source, job_id, title, company, location=None, pay=None, rating=None, indeed_jk=None):
    """A row shaped like the parsers' rows: Glassdoor estimates get no hourly value, and only
    Glassdoor rows have indeed_jk."""
    estimate = source == "glassdoor" and pay is not None and parsers.GD_ESTIMATE in pay
    r = {
        "source": source, "title": title, "company": company, "location": location, "pay": pay,
        "pay_hourly_min": None if estimate else parsers.pay_hourly_min(pay), "rating": rating,
        "url": f"https://example.com/{source}/{job_id}", "job_id": job_id,
    }
    if source == "glassdoor":
        r["indeed_jk"] = indeed_jk
    return r


def synthetic_rows():
    e_acute = C(0xE9)
    return [
        row("indeed", "a1", "Software Engineer Intern (Summer 2027)", "Acme, Inc.", "San Francisco, CA", "$50 an hour"),
        row("glassdoor", "1", "Software Engineer Intern - US", "Acme Inc", "San Francisco, CA",
            "$45 - $60 Per Hour (Employer provided)", 4.25),
        row("glassdoor", "1", "duplicate id, dropped", "Acme Inc"),
        row("indeed", "a2", "Data Science Intern", "Caf" + e_acute + " Labs", None, "$8,000 - $10,000 a month"),
        row("glassdoor", "2", "Data Science Intern 2027", "Cafe" + C(0x301) + " Labs LLC", "Remote", None, 3.0),
        row("indeed", "a3", "Intern, \"quoted\" title", "Comma, Pipe | Co", "New York, NY 10001", "$28.5 an hour"),
        row("indeed", "a4", "Tie A", "Tie Co", None, "$29.5 an hour"),
        row("glassdoor", "3", "Tie A", "Tie Co", None, "$29.5 an hour (Employer provided)", 0.25),
        row("indeed", "a5", "No pay intern", "Zed", "Austin, TX", "Up to $40 an hour"),
        row("glassdoor", "4", "No pay intern", "Zed Corp", None, "$58K - $98K (Glassdoor est.)", 0.35),
        row("indeed", "a6", "Line\nbreak\r\ttab " + C(0x2028) + " title", "Emoji " + C(0x1F600) + " Inc", C(0x7F) + "x",
            "$1 a day"),
        row("glassdoor", "5", "A" * 80, "B" * 40, "C" * 40, "$123,456.78 a year", 5.0),
        row("indeed", "a7", "Weekly intern", None, None, "$700 a week"),
        row("glassdoor", "6", "Tiny pay", "Tiny", None, "$0.004"),
        row("glassdoor", "7", "Huge pay", "Huge", None, "$99999999999999999999999K"),
        row("indeed", "a8", "Software Development Engineer Intern", "Amazon.com Services LLC", "Seattle, WA",
            "$55.10 an hour"),
        row("glassdoor", "8", "Software Engineer Intern", "Amazon", "Seattle, WA", "$40 - $60", 3.75),
        # twins: the Glassdoor partner link names the Indeed job, whatever the company is called
        row("indeed", "a9", "Software Engineer Intern - Summer 2027", "IMC Financial Markets", "Chicago, IL",
            "$200,000 a year"),
        row("glassdoor", "9", "Software Engineer Intern - Summer 2027", "IMC Trading", "Chicago, IL",
            "$200K (Employer provided)", 4.5, indeed_jk="a9"),
        row("glassdoor", "12", "Software Engineer Intern", "Acme", None, None, 4.0, indeed_jk="a9"),  # a9 is taken
        row("glassdoor", "13", "Ghost intern", "Ghost", None, None, None, indeed_jk="not-on-this-page"),
        row("glassdoor", "14", "Backend Intern", "Twin Co", None, "$30 Per Hour (Employer provided)", 3.5,
            indeed_jk="a14"),
        row("indeed", "a14", "Backend Intern", "Twin Co LLC", None, "$31 an hour"),
        row("indeed", "a15", "Backend Intern", "Twin Co", None, "$32 an hour"),  # the pair is closed
        # same site, same key, different ids: never merged with each other
        row("glassdoor", "10", "Quant Intern", "Same Co", None, None, 4.0),
        row("glassdoor", "11", "Quant Intern", "Same Co Inc", None, None, 4.0),
        row("indeed", "a10", "Quant Intern", "Same Co", None, "$45 an hour"),
        row("indeed", "a11", "Quant Intern (Summer 2027)", "Same Co", None, "$46 an hour"),
        row("indeed", "a12", "Quant Intern", "Same Co", None, "$47 an hour"),
        row("glassdoor", "17", "C++ Developer Intern", "ScalpTrade", None, None, None),
        row("glassdoor", "18", "C# Developer Intern", "ScalpTrade", None, None, None),
        row("indeed", "a17", "C# Developer Intern", "ScalpTrade", None, "$25 an hour"),
        # Glassdoor estimates never beat employer pay
        row("indeed", "a16", "Estimate intern", "Est Co", None, "$20 an hour"),
        row("glassdoor", "15", "Estimate intern", "Est Co", None, "$100K - $150K (Glassdoor est.)", 4.0),
        row("glassdoor", "16", "Only estimate", "Solo", None, "$90K (Glassdoor est.)", 3.0),
    ]


def make_units():
    rng = random.Random(SEED + 1)
    units = {}

    units["clean_lines"] = [{"in": s, "out": attempt(parsers.clean_lines, s)} for s in [
        "", "a", "a\nb", "  *   ### [x](y)  \n\n**bold**", "&amp;&hellip;&#8217;&#x2019;&bogus;&#65;",
        "\\&\\_\\[x\\]", "![alt](u) text ![](v)", "* - + nested", "#######  seven", "line" + C(0x2028) + "two",
        "a\r\nb\rc" + C(0x85) + "d" + C(0x0B) + "e" + C(0x0C) + "f" + C(0x1C) + "g",
        C(0xA0) + "x" + C(0x3000) + "y" + C(0x200B), "&#0;", "&#x110000;", "trailing\n\n", "\n",
    ]]

    pays = [
        None, "", "$62 an hour", "From $105,000 a year", "Up to $40 an hour", "$8,000 - $10,000 a month",
        "$25.18 - $35.19 Per Hour (Employer provided)", "$58K - $98K (Glassdoor est.)", "$40 - $60", "$400 - $600",
        "$299", "$300", "$1,500 a week", "$200 a day", "$200 today", "$200 Monday", "$2k", "$ 50 /hr", "$50/yr",
        "$5 annual", "$" + C(0x663) + C(0x664) + " an hour", "$1" + C(0xA0) + "K", "$.5", "$5.", "$1,,2",
        "no money", "$0.005 an hour", "$0.015 an hour", "$1.005 an hour", "$2.675 an hour",
        "$50 por hora", "$7,188 - $12,100 por mes", "$71,000 por a" + C(0xF1) + "o", "$71,000 por ano",
        "$19.50 - $22 por hora", "Desde $20 por hora", "$162K - $207K (Glassdoor est.)",
    ]
    units["pay_hourly_min"] = [{"in": p, "out": attempt(parsers.pay_hourly_min, p)} for p in pays]

    companies = [
        None, "", "Acme, Inc.", "Mercor (Poland)", "Amazon.com Services LLC", "Amazon.com", "AMAZON.COM SERVICES",
        "Nestl" + C(0xE9), "O" + C(0x2019) + "Reilly Media", "McDonald's", "Inc", "US", "Co Co", "LLC Inc",
        "Tesla (US) Inc", "  spaced   out  ", "X.com", "x.comservices", "x.com  services llc",
        C(0xFB01) + "nance corp", C(0x130) + "stanbul Ltd", "Stra" + C(0xDF) + "e GmbH",
    ]
    units["norm_company"] = [{"in": c, "out": dedupe.norm_company(c)} for c in companies]

    titles = [
        None, "", "Software Engineer Intern - US", "Software Engineer Intern, USA", "Intern (US)", "Intern [US]",
        "Intern " + C(0x2013) + " United States", "Intern" + C(0x2014) + "us", "Software Engineer Intern (Summer 2027)",
        "Software Development Engineer Intern", "Engineering Intern", "Software Engineer Intern (AI Platform) - 2027 Summer",
        "Start-up intern", "Startup intern", "Business intern - usa ", "Fall 2026 Intern", "Intern|US",
        "Intern: united states", "Intern - us - us", "Campus (us) intern", C(0x130) + "ntern",
        "C++ Developer Intern", "C# Developer Intern", "C Developer Intern", "F# intern", ".NET Intern",
        "ASP.NET Developer Intern", "Vb.Net intern", ".network intern", "Abc++ intern", "C++/C# Intern",
        "c#c++ intern", "Objective-C++ intern", "(C#) intern", "Intern, C++ - US",
    ]
    units["norm_title"] = [{"in": t, "out": dedupe.norm_title(t)} for t in titles]

    units["indeed_is_spanish"] = [
        {"file": rel, "out": parsers.indeed_is_spanish((FIXTURES / rel).read_bytes().decode("utf-8"))}
        for rel, source in fixture_pages() if source == "indeed"]
    units["indeed_is_spanish"] += [{"in": s, "out": parsers.indeed_is_spanish(s)} for s in [
        "", parsers.IN_SPANISH, "  " + parsers.IN_SPANISH + " x", "**" + parsers.IN_SPANISH + "**",
        "x " + parsers.IN_SPANISH, "Busqueda de salarios:", "B" + "u" + C(0x301) + "squeda de salarios:"]]

    slugs = ["", "San Francisco, CA", "  --C++ & ML/AI--  ", "Caf" + C(0xE9), C(0x130) + "stanbul", "a" + C(0x212A)]
    units["slugify"] = [{"in": s, "out": sources.slugify(s)} for s in slugs]

    roles = ["software engineer intern", "C++ & ML/AI intern (Summer '27)", "a+b=c?d#e", "~tilde*star",
             "Ingeni" + C(0xE9) + "r " + C(0x1F600), "", "  spaced  "]
    locations = [None, "", "San Francisco, CA", "New York/NY", "  new   YORK, ny ", C(0xFC) + "ber~town*"]
    units["indeed_url"] = []
    for r in roles:
        for loc in locations:
            for page in (1, 2):
                units["indeed_url"].append({"args": [r, loc, page], "out": sources.indeed_url(r, loc, page)})
    units["glassdoor_url"] = []
    for r in roles:
        for loc, loc_type, loc_id in [("San Francisco, CA", "C", 1147401), ("Remote", "S", 11047), ("", "C", 5),
                                      (None, None, None), ("Tokyo", "C", 0), ("Chicago, IL", "C", "1128808")]:
            for page in (1, 2):
                if loc is None and loc_id is not None:
                    continue
                out = sources.glassdoor_url(r, loc, loc_type, loc_id, page)
                units["glassdoor_url"].append({"args": [r, loc, loc_type, loc_id, page], "out": out})
    units["autocomplete_url"] = [{"in": s, "out": sources.glassdoor_autocomplete_url(s)}
                                 for s in ["Chicago, IL", "New York/NY", "a~b*c", C(0xFC) + "ber " + C(0x1F600)]]

    chicago = [{"label": "Chicago, IL (US)", "locationType": "C", "locationId": 1128808, "country2LetterIso": "US"}]
    two = [{"label": "Paris (FR)", "locationType": "C", "locationId": 1, "country2LetterIso": "FR"},
           {"label": "Paris, TX (US)", "locationType": "C", "locationId": 2, "country2LetterIso": "US"}]
    exact = two + [{"label": "Paris", "locationType": "S", "locationId": 3, "country2LetterIso": "FR"}]
    no_us = [{"label": "Berlin (DE)", "locationType": "C", "locationId": 9, "country2LetterIso": "DE"}]
    null_id = [{"label": "Nowhere", "locationType": "C", "locationId": None}]
    resolve_cases = [
        ("San Francisco, CA", None), ("san francisco", None), (" SAN   FRANCISCO,\tCA ", None), ("Remote", None),
        (C(0xA0) + "Remote" + C(0x3000), None), ("", None), ("   ", None), (None, None), ("Seattle", None),
        ("Chicago, IL", None), ("Chicago, IL", json.dumps(chicago)), ("Paris", json.dumps(two)),
        ("Paris", json.dumps(exact)), (" paris ", json.dumps(exact)), ("Berlin", json.dumps(no_us)),
        ("Atlantis", "[]"), ("Atlantis", "{}"), ("Atlantis", "null"), ("Nowhere", json.dumps(null_id)),
        ("Broken", "<html>not json</html>"), ("Missing key", json.dumps([{"label": "x", "locationId": 4}])),
        ("Quote's \"both\"", "[]"),
    ]
    units["resolve"] = []
    for location, response in resolve_cases:
        fetch_raw = None if response is None else (lambda url, _r=response: _r)
        try:
            out = list(sources.resolve_glassdoor_location(location, fetch_raw))
        except LookupError as e:
            out = {"error": "LookupError", "message": str(e)}
        except ValueError as e:
            out = {"error": "ValueError", "message": str(e)}
        units["resolve"].append({"location": location, "response": response, "out": out})

    compact = []
    for p in pays[1:] + ["$1 a day (Employer provided)", "$50 an hour an hour"]:
        for hourly in (None, parsers.pay_hourly_min(p), 28.5, 29.5, 0.5, 1.5, 2.675, 1e22, 12345.4999):
            r = {"pay": p, "pay_hourly_min": hourly}
            compact.append({"row": r, "out": intern_intel.compact_pay(r)})
    units["compact_pay"] = compact

    units["ascii_text"] = [{"in": s, "out": intern_intel.ascii_text(s)} for s in [
        None, "", "Caf" + C(0xE9) + " " + C(0x2013) + " " + C(0x2014) + " " + C(0x2019) + C(0x2026),
        C(0xFB01) + C(0xB2) + C(0x2460) + C(0x1D7D9), C(0x1F600) + C(0x4E2D), C(0x7F) + C(0x00) + "\t",
    ]]

    rows = synthetic_rows()
    merged = dedupe.merge_rows(rows)
    filters = [(None, None, None), ("intern", None, None), ("SOFTWARE", "san", None), (None, None, 30),
               (None, None, 0), ("", "", None), (None, "remote", 29.5), (C(0xE9), None, None)]
    units["merge"] = {
        "rows": rows,
        "merged": merged,
        "sorted": dedupe.sort_rows(merged),
        "filtered": [{"args": list(f), "out": dedupe.sort_rows(dedupe.filter_rows(merged, *f))} for f in filters],
        "outputs": outputs_for(dedupe.sort_rows(merged)),
    }

    # Every fixture row together, in file order and shuffled: a stress test for merge and sort.
    all_rows = []
    for rel, source in fixture_pages():
        all_rows += parsers.PARSERS[source]((FIXTURES / rel).read_bytes().decode("utf-8"))
    shuffled = all_rows[:]
    rng.shuffle(shuffled)
    units["merge_all"] = []
    for name, rs in (("file order", all_rows), ("shuffled", shuffled)):
        m = dedupe.sort_rows(dedupe.merge_rows(rs))
        units["merge_all"].append({"name": name, "rows": rs, "sorted": m, "outputs": outputs_for(m)})

    units["empty_outputs"] = outputs_for([])
    write("units.json", units)


# ---------------------------------------------------------------- fuzz.json

def make_fuzz():
    rng = random.Random(SEED + 2)
    cases = []
    for _ in range(1500):
        s = random_text(rng)
        hourly = rng.choice([None, 0.0, 28.5, rng.uniform(0, 200), float(rng.randint(0, 10**6))])
        cases.append({
            "in": s,
            "hourly": hourly,
            "clean_lines": attempt(parsers.clean_lines, s),
            "pay_hourly_min": attempt(parsers.pay_hourly_min, s),
            "norm_company": attempt(dedupe.norm_company, s),
            "norm_title": attempt(dedupe.norm_title, s),
            "slugify": attempt(sources.slugify, s),
            "ascii_text": attempt(intern_intel.ascii_text, s),
            "compact_pay": attempt(intern_intel.compact_pay, {"pay": s, "pay_hourly_min": hourly}),
            "indeed_url": attempt(sources.indeed_url, s, s, 1),
            "autocomplete_url": attempt(sources.glassdoor_autocomplete_url, s),
        })
    write("fuzz.json", {"cases": cases})


# ---------------------------------------------------------------- pipeline.json

PIPELINE = [
    {"name": "sf_swe_p2", "argv": ["--offline", "--pages", "2"]},
    {"name": "ny_ds_p1", "argv": ["--offline", "--role", "data science intern", "--location", "New York, NY"]},
    {"name": "remote_swe_p1", "argv": ["--offline", "--location", "Remote"]},
    {"name": "sf_filtered", "argv": ["--offline", "--pages", "2", "--title-includes", "software engineer",
                                     "--location-includes", "san francisco", "--min-hourly", "50"]},
    {"name": "sf_limit", "argv": ["--offline", "--limit", "5"]},
    {"name": "sf_negative_limit", "argv": ["--offline", "--limit=-70", "--pages=2"]},
    {"name": "sf_nothing_left", "argv": ["--offline", "--min-hourly", "1e9"]},
    {"name": "offline_unknown_location", "argv": ["--offline", "--location", "Chicago, IL"]},
    {"name": "offline_us_wide", "argv": ["--offline", "--location", ""]},
    {"name": "print_urls_p2", "argv": ["--print-urls", "--pages", "2"]},
    {"name": "print_urls_odd", "argv": ["--print-urls", "--role", "C++ & ML/AI intern (Summer '27)",
                                        "--location", "  new   YORK, ny "]},
    {"name": "print_urls_us_wide", "argv": ["--print-urls", "--location", "", "--role", "Data Scientist Intern"]},
    {"name": "print_urls_unicode", "argv": ["--print-urls", "--role", "Ingeni" + C(0xE9) + "r intern " + C(0xFC),
                                            "--location", "Remote"]},
    {"name": "print_urls_offline_lookup", "argv": ["--print-urls", "--offline", "--location", "Tokyo"]},
    {"name": "from_dir_sf", "argv": ["--from-dir", "{dir}"],
     "files": [["glassdoor_p2.md", "glassdoor_p2.md"], ["indeed_p2.md", "indeed_p2.md"],
               ["glassdoor_p1.md", "glassdoor_p1.md"], ["indeed_p1.md", "indeed_p1.md"],
               ["ny_ds_indeed_p1.md", "ny_ds_indeed_p1.md"], ["indeed_p1.md", "notes.txt"]]},
    {"name": "from_dir_no_page_number", "argv": ["--from-dir", "{dir}", "--min-hourly", "20"],
     "files": [["ny_ds_glassdoor_p1.md", "glassdoor.md"], ["ny_ds_indeed_p1.md", "indeed.md"]]},
    {"name": "from_dir_mcp_pages", "argv": ["--from-dir", "{dir}"],
     "files": [["mcp/ny_ds_glassdoor_p1.md", "glassdoor_p1.md"], ["mcp/remote_swe_indeed_p1.md", "indeed_p1.md"]]},
    {"name": "from_dir_two_page_ones", "argv": ["--from-dir", "{dir}"],
     "files": [["indeed_p1.md", "indeed.md"], ["indeed_p2.md", "indeed_p1.md"], ["glassdoor_p2.md", "glassdoor_p02.md"]]},
    {"name": "from_dir_chicago", "argv": ["--from-dir", "{dir}"],
     "files": [["chicago_swe_indeed_p1.md", "indeed_p1.md"], ["chicago_swe_glassdoor_p1.md", "glassdoor_p1.md"]]},
    {"name": "from_dir_ny_spanish", "argv": ["--from-dir", "{dir}"],
     "files": [["ny_ds_es_indeed_p1.md", "indeed_p1.md"], ["ny_ds_glassdoor_p1.md", "glassdoor_p1.md"]]},
    {"name": "from_dir_ny_spanish_min_hourly", "argv": ["--from-dir", "{dir}", "--min-hourly", "30"],
     "files": [["ny_ds_es_indeed_p1.md", "indeed_p1.md"]]},
    {"name": "from_dir_empty", "argv": ["--from-dir", "{dir}"], "files": []},
    {"name": "from_dir_missing", "argv": ["--from-dir", "{dir}/nope"], "files": []},
]


def make_pipeline():
    cases = []
    for case in PIPELINE:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as out_dir:
            for src, dest in case.get("files", []):
                shutil.copyfile(FIXTURES / src, Path(tmp) / dest)
            argv = [a.replace("{dir}", tmp) for a in case["argv"]]
            saved = intern_intel.OUT_DIR
            intern_intel.OUT_DIR = Path(out_dir)
            try:
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    code = intern_intel.run(intern_intel.parse_args(argv))
                args = intern_intel.parse_args(argv)
                data = {}
                if not args.print_urls and not (args.from_dir and not Path(args.from_dir).is_dir()):
                    with contextlib.redirect_stdout(io.StringIO()):
                        plan, _, all_rows = intern_intel.fetch_rows(args)
                    merged, rows = intern_intel.build_table(all_rows, args)
                    data = {"plan": [[s, n, u.replace(tmp, "{dir}").replace("\\", "/")] for s, n, u in plan],
                            "all_rows": all_rows, "merged": merged, "rows": rows}
                files = {}
                for name in ("intern_intel.json", "intern_intel.csv"):
                    p = Path(out_dir) / name
                    files[name] = p.read_bytes().decode("utf-8") if p.exists() else None
            finally:
                intern_intel.OUT_DIR = saved
            cases.append({**case, "exit": code, "stdout": buf.getvalue().replace(tmp, "{dir}"), "files": case.get("files", []),
                          "out_json": files["intern_intel.json"], "out_csv": files["intern_intel.csv"], **data})
    write("pipeline.json", {"cases": cases})


# ---------------------------------------------------------------- argv.json

ARGV = [
    [], ["--help"], ["-h"], ["--he"], ["-hx"], ["-h=x"], ["-h-x"], ["--role=", "--pages=2"],
    ["--save-fixtures", "abc"], ["--save-fixtures", "-x"], ["--save-fixtures"], ["--save-fixtures=", "--offline"],
    ["--min-hourly", "-5"], ["--min-hourly", "-1e5"], ["--min-hourly", "-.5"], ["--min-hourly", " 1_0.5 "],
    ["--min-hourly", "1e"], ["--min-hourly", "1.e2"], ["--min-hourly", "+.5"], ["--min-hourly", "1__0"],
    ["--min-hourly", C(0x663) + "." + C(0x664)], ["--min-hourly"],
    ["--limit", "-1"], ["--limit", "1_0"], ["--limit", "abc"], ["--limit", "007"], ["--limit", "2.0"],
    ["--role", "-x y"], ["--role", "-5"], ["--role", "-x"], ["--role", "--"], ["--role", "a", "b", "--zz=1", "-q"],
    ["--offline=1"], ["--offline="], ["--refresh", "--refresh"],
    ["--pages", " 2 "], ["--pages", "3"], ["--pages", "0"], ["--pages", "-1"], ["--pages", C(0x662)],
    ["--pages=", "--loc", "x"], ["--pages", "3", "--loc", "x"], ["x", "--pages", "3"],
    ["-"], ["--", "x"], ["--=x"], ["--loc", "x"], ["--loc=x"], ["--location-i", "x"], ["--from", "d"],
    ["--print-urls", "--from-dir", ""], ["--from-dir", "x", "--offline"], ["--from-dir", "x", "--refresh"],
    ["--from-dir", "x", "--print-urls"], ["--from-dir", "x", "--save-fixtures"], ["--from-dir", "x", "--save-fixtures", "p"],
    ["--from-dir", "x", "--title-includes", "a", "--location-includes", "b", "--min-hourly", "1", "--limit", "2"],
    ["--title", "t", "--min", "3", "--lim", "4", "--of", "--ref", "--pr", "--sav", "pre_"],
    ["--location", "New York, NY", "--location", "Remote"],
]


def encode(value):
    if isinstance(value, float):
        return {"float": repr(value)}
    return value


def make_argv():
    cases = []
    for argv in ARGV:
        err, out = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
                ns = intern_intel.parse_args(argv)
            cases.append({"argv": argv, "args": {k: encode(v) for k, v in vars(ns).items()}})
        except SystemExit as e:
            if e.code == 0:
                cases.append({"argv": argv, "exit": 0, "help": out.getvalue()})
            else:
                last = err.getvalue().rstrip("\n").splitlines()[-1]
                cases.append({"argv": argv, "exit": e.code, "error": last.split(": error: ", 1)[1]})
    write("argv.json", {"cases": cases})


if __name__ == "__main__":
    make_parse()
    make_windows()
    make_units()
    make_fuzz()
    make_pipeline()
    make_argv()
