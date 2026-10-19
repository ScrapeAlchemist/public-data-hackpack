"""Merge Indeed and Glassdoor rows into one list without duplicates.

A Glassdoor row and an Indeed row are the same job when
  1. the Glassdoor row's indeed_jk (from its partner link, see parsers.py) is the Indeed
     row's job_id: an exact join that also works when the sites name the employer
     differently ('IMC Trading' vs 'IMC Financial Markets'); or else
  2. norm_company(company) + '|' + norm_title(title) match (the dedupe key).
Location is not part of the key: one search covers one area, and the sites write the same
place differently ('Hybrid work in San Francisco, CA' vs 'San Francisco, CA').
Two rows from the same site are never merged unless they have the same job_id: apart from
Indeed's repeated copy, which the parser already drops, a site does not list one job twice
under two ids, so they are two jobs even when their keys match ('C++ Developer Intern' and
'C# Developer Intern' at one company).

The JavaScript version must produce the same output, so every step below is plain string
work with ASCII regexes. Keep the two in sync.

fold:          NFKD, remove accent marks U+0300..U+036F, lowercase. Both keys start with it.
norm_company:  fold; drop (...) parts ('Mercor (Poland)' -> 'mercor');
               '.com services' -> '.com'; drop '.com'; drop apostrophes; every run of
               non [a-z0-9] -> one space; then drop trailing words in COMPANY_SUFFIXES while
               more than one word is left.
norm_title:    fold; drop a trailing country tag ('- US', ', USA', '(US)');
               spell out 'c++', 'c#', 'f#', '.net' as 'cpp', 'csharp', 'fsharp', 'dotnet';
               drop apostrophes; every run of non [a-z0-9] -> one space (so the words
               inside (...) and [...] stay); drop season words and years (summer, 2027,
               start); then the TITLE_SYNONYMS rewrites; collapse spaces.

Why the words inside brackets stay in the title: many companies put the team there.
'Software Engineer Intern (AI Platform) - 2027 Summer' and 'Software Engineer Intern
(Global Payment) - 2027 Summer' are two jobs. Dropping the brackets merged 13 ByteDance
roles into one row on the San Francisco test search. '(Summer 2027)' still goes away
because season words and years are removed after the brackets are gone.

merge_rows:    rows in input order. A later row with the same (source, job_id) as an earlier
               one is dropped. Then twins (rule 1) are paired: each Indeed row with at most
               one Glassdoor row, the first in input order. Then groups form in order of
               first appearance: a twin joins its partner's group; any other row joins the
               first group with its key that has no row from its site and is not a twin
               pair, or starts a new group. So a group holds at most one row per site.
               title, company, location, rating: first non-null value in the group.
               pay + pay_hourly_min: taken together from the row with the highest
               pay_hourly_min (first one on a tie); if no row has pay_hourly_min, the first
               non-null pay and pay_hourly_min = None. Glassdoor estimates have no
               pay_hourly_min (see parsers.py), so employer pay always wins over them.
               sources: in the fixed order indeed, glassdoor. urls: one per source.
               key: the dedupe key of the group's first row. Two groups can share a key.
sort_rows:     pay_hourly_min descending, rows without it last; ties keep merge order.
"""

import re
import unicodedata

SOURCE_ORDER = ("indeed", "glassdoor")
COMPANY_SUFFIXES = {"inc", "llc", "corp", "corporation", "co", "ltd", "usa", "us"}
SEASON_WORDS = re.compile(r"\b(?:summer|fall|autumn|winter|spring|start|20\d\d)\b")
COUNTRY_TAG = re.compile(r"\s*(?:[-,|:\u2013\u2014]\s*|[(\[]\s*)(?:us|usa|united states)\s*[)\]]?\s*$")
APOSTROPHES = re.compile(r"['\u2019]")
PARENS = re.compile(r"\([^)]*\)")
COMBINING_MARKS = re.compile("[\u0300-\u036f]")
TITLE_SYNONYMS = [
    (re.compile(r"\bsoftware development engineer\b"), "software engineer"),
    (re.compile(r"\bengineering intern\b"), "engineer intern"),
]
# Names that punctuation removal would otherwise turn into 'c' or 'net'.
PROTECTED_TOKENS = [
    (re.compile(r"(?<![a-z0-9])c\+\+"), " cpp "),
    (re.compile(r"(?<![a-z0-9])c#"), " csharp "),
    (re.compile(r"(?<![a-z0-9])f#"), " fsharp "),
    (re.compile(r"\.net(?![a-z0-9])"), " dotnet "),
]


def _fold(text):
    """NFKD, drop the accent marks it splits off ('Nestle' with an accent -> 'nestle'), lowercase."""
    return COMBINING_MARKS.sub("", unicodedata.normalize("NFKD", text or "")).lower()


def _words(text):
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def norm_company(name):
    s = PARENS.sub(" ", _fold(name))
    s = re.sub(r"\.com\s+services\b", ".com", s)
    s = s.replace(".com", " ")
    s = APOSTROPHES.sub("", s)
    words = _words(s).split()
    while len(words) > 1 and words[-1] in COMPANY_SUFFIXES:
        words.pop()
    return " ".join(words)


def norm_title(title):
    s = COUNTRY_TAG.sub("", _fold(title))
    for pattern, repl in PROTECTED_TOKENS:
        s = pattern.sub(repl, s)
    s = _words(APOSTROPHES.sub("", s))   # from here on the text is plain [a-z0-9 ]
    s = SEASON_WORDS.sub(" ", s)
    for pattern, repl in TITLE_SYNONYMS:
        s = pattern.sub(repl, s)
    return " ".join(s.split())


def dedupe_key(row):
    return norm_company(row.get("company")) + "|" + norm_title(row.get("title"))


def _twins(rows):
    """{row index: partner row index} for Glassdoor rows whose indeed_jk is an Indeed job_id here."""
    indeed_at = {}
    for i, r in enumerate(rows):
        if r["source"] == "indeed":
            indeed_at.setdefault(r["job_id"], i)
    twin = {}
    for i, r in enumerate(rows):
        if r["source"] != "glassdoor" or r.get("indeed_jk") is None:
            continue
        j = indeed_at.get(r["indeed_jk"])
        if j is not None and j not in twin:   # one Glassdoor row per Indeed row, the first wins
            twin[i], twin[j] = j, i
    return twin


def merge_rows(rows):
    seen_ids = set()
    unique = []
    for row in rows:
        ident = (row["source"], row["job_id"])
        if ident in seen_ids:
            continue
        seen_ids.add(ident)
        unique.append(row)

    twin = _twins(unique)
    groups = []          # [[rows]] in order of first appearance
    group_of = {}        # row index -> group index
    by_key = {}          # key -> indexes of groups that rows can still join by name
    for i, row in enumerate(unique):
        if i in twin:
            if twin[i] in group_of:          # the partner came first
                g = group_of[twin[i]]
                groups[g].append(row)
            else:                            # a twin pair takes no other rows
                g = len(groups)
                groups.append([row])
            group_of[i] = g
            continue
        key = dedupe_key(row)
        g = next((g for g in by_key.get(key, []) if all(r["source"] != row["source"] for r in groups[g])), None)
        if g is None:
            g = len(groups)
            groups.append([row])
            by_key.setdefault(key, []).append(g)
        else:
            groups[g].append(row)
        group_of[i] = g

    merged = []
    for group in groups:
        key = dedupe_key(group[0])

        def first(field):
            return next((r[field] for r in group if r.get(field) is not None), None)

        paid = [r for r in group if r.get("pay_hourly_min") is not None]
        if paid:
            best = max(paid, key=lambda r: r["pay_hourly_min"])  # max() keeps the first on ties
            pay, hourly = best["pay"], best["pay_hourly_min"]
        else:
            pay, hourly = first("pay"), None
        urls = {}
        for r in group:
            urls.setdefault(r["source"], r["url"])   # one row per source, so one url
        merged.append({
            "title": first("title"),
            "company": first("company"),
            "location": first("location"),
            "pay": pay,
            "pay_hourly_min": hourly,
            "rating": first("rating"),
            "sources": [s for s in SOURCE_ORDER if s in urls],
            "urls": {s: urls[s] for s in SOURCE_ORDER if s in urls},
            "key": key,
        })
    return merged


def sort_rows(merged):
    return sorted(merged, key=lambda r: (r["pay_hourly_min"] is None, -(r["pay_hourly_min"] or 0)))


def filter_rows(merged, title_includes=None, location_includes=None, min_hourly=None):
    """Case-insensitive substring filters; min_hourly drops rows without a known hourly pay."""
    out = []
    for r in merged:
        if title_includes and title_includes.lower() not in (r["title"] or "").lower():
            continue
        if location_includes and location_includes.lower() not in (r["location"] or "").lower():
            continue
        if min_hourly is not None and (r["pay_hourly_min"] is None or r["pay_hourly_min"] < min_hourly):
            continue
        out.append(r)
    return out
