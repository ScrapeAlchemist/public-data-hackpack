"""Turn Indeed and Glassdoor search-page markdown into rows.

Row = {source, title, company, location, pay, pay_hourly_min, rating, url, job_id}
Glassdoor rows have one more field, indeed_jk (see "Glassdoor and Indeed twins" below).

The parsers accept both markdown renderings we have seen for the same page:
  - REST /request with data_format=markdown: '*   ### [Title](/rc/clk?jk=...)', 4-space
    indents, logos as ![Company Logo](...), '&hellip;'.
  - MCP scrape_as_markdown: bare lines, '&' escaped as '\\&' (also inside URLs), logos as
    plain 'Company Logo' text.
clean_lines() reduces both to the same list of plain lines, then the parsers walk it.

Layout of one listing after clean_lines():

  Indeed     [Title](/rc/clk?jk=<16 hex>&...)      (or /viewjob?jk=, /pagead/clk?)
             optional badges (Easily apply, ...)
             Company
             Location                              ('City, ST', 'City, ST 94105', 'Remote', 'Hybrid work in ...')
             optional '(Chelsea area)' / 'Transit information' + stop name
             optional pay ('$62 an hour', '$8,000 - $10,000 a month', 'From $105,000 a year')
             job type, schedule, snippet lines, 'View all ...',
             'Salary Search: [...](...fromjk=<16 hex>...)'
  The list ends at the pagination line '[1](#)'. After it the page embeds the first job's
  full description, which we ignore.

  Glassdoor  optional 'Company Logo'
             Company
             optional rating ('3.4')
             [Title](https://www.glassdoor.com/job-listing/...htm?jl=<id>)
             optional location (missing on some listings)
             optional pay ('$25.18 - $35.19 Per Hour (Employer provided)', '$58K - $98K (Glassdoor est.)')
             optional badges, snippet, 'Skills: ...'

Every Indeed page we saved has one repeated entry: a /viewjob?jk=<synthetic-looking id> copy
of a real listing. Usually its 'Salary Search' link still carries the real id as fromjk, so a
/viewjob entry whose jk differs from its fromjk is dropped. Some 'Salary Search' lines have no
link; a /viewjob entry like that is dropped when another entry on the page has the same
title, company, location and pay. Sponsored entries whose link has no jk have no job id and
are skipped.

Indeed sometimes serves the US search page in Spanish ('$50 por hora', 'Busqueda de
salarios:' with an accent). The parser reads the Spanish pay units and badge we have seen;
indeed_is_spanish() lets the caller fetch the page once more.

Glassdoor and Indeed twins: many Glassdoor listings carry a partner link
'/partner/jobListing.htm?...jobListingId=<jl>&jrtk=5-...-<16 hex>'. The last 16 hex digits
of jrtk are the Indeed jk of the same posting. parse_glassdoor stores them as indeed_jk
(None when the link is missing), and dedupe.merge_rows joins on it before it compares names.
"""

import math
import re

# ---------------------------------------------------------------- cleaning

_ENTITIES = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ", "hellip": "\u2026"}
_ENTITY = re.compile(r"&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);")
_ESCAPED = re.compile(r"\\([\\`*_{}\[\]()#+\-.!&|<>~])")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_ODD_SPACES = re.compile(r"[\u00a0\u2000-\u200a\u202f\u205f\u3000]")


def _entity(m):
    name = m.group(1)
    if name.startswith(("#x", "#X")):
        return chr(int(name[2:], 16))
    if name.startswith("#"):
        return chr(int(name[1:]))
    return _ENTITIES.get(name, m.group(0))  # unknown names stay as written


def clean_lines(md):
    """Markdown -> list of non-empty plain lines (bullets, headings, bold, images removed)."""
    md = _ENTITY.sub(_entity, md)
    md = _ESCAPED.sub(r"\1", md)
    md = _ODD_SPACES.sub(" ", md)
    out = []
    for raw in md.splitlines():
        s = raw.strip()
        s = re.sub(r"^(?:[*+-]\s+)+", "", s)   # list bullets, possibly nested
        s = re.sub(r"^#{1,6}\s+", "", s)       # headings
        s = _IMAGE.sub(r"\1", s)               # images -> alt text
        s = s.replace("**", "").strip()
        if s:
            out.append(s)
    return out


# ---------------------------------------------------------------- pay

_AMOUNT = re.compile(r"\$\s?(\d[\d,]*(?:\.\d+)?)\s*([kK])?")


def round2(x):
    """Half-up rounding to cents (Python's round() rounds 0.125 to 0.12, this gives 0.13).

    JavaScript port: write Math.floor(x * 100 + 0.5) / 100, not Math.round, so the two
    languages do the same float steps and agree on every input.
    """
    return math.floor(x * 100 + 0.5) / 100


def pay_hourly_min(pay):
    """Lower bound of a pay string in USD per hour, or None.

    Units: 'hour' = 1, 'year' = /2080, 'month' = /173.33, 'week' = /40, 'day' = /8, 'K' = x1000.
    Spanish Indeed pages: 'por hora' = 1, 'por mes' = /173.33, 'por a\u00f1o' (with n-tilde) = /2080.
    Glassdoor often shows no unit. Then: a K amount is yearly, under $300 is hourly, anything
    else is monthly (Glassdoor's unit-less ranges matched Indeed's 'a month' for the same jobs).
    'Up to $X' has no lower bound, so it gives None.
    """
    if not pay:
        return None
    p = pay.lower()
    if p.startswith("up to"):
        return None
    m = _AMOUNT.search(pay)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    has_k = m.group(2) is not None
    if has_k:
        value *= 1000
    if "hour" in p or "/hr" in p or "por hora" in p:
        divisor = 1
    elif "year" in p or "/yr" in p or "annual" in p or "por a\u00f1o" in p:
        divisor = 2080
    elif "month" in p or "/mo" in p or "por mes" in p:
        divisor = 173.33
    elif "week" in p or "/wk" in p:
        divisor = 40
    elif re.search(r"\bday\b", p):
        divisor = 8
    elif has_k:
        divisor = 2080
    elif value < 300:
        divisor = 1
    else:
        divisor = 173.33
    return round2(value / divisor)


# ---------------------------------------------------------------- Indeed

IN_LINK = re.compile(r"^\[(?P<title>.+?)\]\((?P<href>/(?:rc/clk|viewjob|pagead/clk)[^)\s]*)\)$")
IN_JK = re.compile(r"[?&]jk=([0-9a-f]{16})")
IN_FROMJK = re.compile(r"[?&]fromjk=([0-9a-f]{16})")
IN_PAY = re.compile(r"^(?:From |Up to )?\$\d[\d,.]*K?(?: - \$\d[\d,.]*K?)? "
                    r"(?:an hour|a year|a month|a week|a day|por hora|por mes|por a\u00f1o)$")
IN_BADGES = {"Easily apply", "Responsive employer", "Urgently hiring", "New", "Sponsored",
             "Hiring multiple candidates", "Actively hiring",
             "Post\u00falate r\u00e1pidamente"}   # Spanish page: 'Easily apply'
IN_ZIP = re.compile(r"\s+\d{5}$")
IN_SPANISH = "B\u00fasqueda de salarios:"     # Spanish page: 'Salary Search:'


def indeed_is_spanish(md):
    """True when Indeed served the search page in Spanish."""
    return any(line.startswith(IN_SPANISH) for line in clean_lines(md))


def _indeed_end(lines):
    for i, line in enumerate(lines):
        if line == "[1](#)" or line.startswith("Get email updates") or line == "People also searched:":
            return i
    return len(lines)


def parse_indeed(md):
    lines = clean_lines(md)
    end = _indeed_end(lines)
    starts = [i for i in range(end) if IN_LINK.match(lines[i])]
    rows, unchecked = [], []
    for n, s in enumerate(starts):
        m = IN_LINK.match(lines[s])
        block = lines[s + 1:(starts[n + 1] if n + 1 < len(starts) else end)]
        href = m.group("href")
        jk = IN_JK.search(href)
        jk = jk.group(1) if jk else None
        fromjk = next((f.group(1) for f in map(IN_FROMJK.search, block) if f), None)
        if href.startswith("/viewjob") and fromjk and jk != fromjk:
            continue  # repeated copy of another listing on this page
        job_id = jk or fromjk
        if not job_id:
            continue
        b = [x for x in block if x not in IN_BADGES]
        company = b[0] if b else None
        location = IN_ZIP.sub("", b[1]) if len(b) > 1 else None
        pay = next((x for x in b[2:] if IN_PAY.match(x)), None)
        rows.append({
            "source": "indeed",
            "title": m.group("title").strip(),
            "company": company,
            "location": location,
            "pay": pay,
            "pay_hourly_min": pay_hourly_min(pay),
            "rating": None,
            "url": f"https://www.indeed.com/viewjob?jk={job_id}",
            "job_id": job_id,
        })
        unchecked.append(href.startswith("/viewjob") and not fromjk)
    # A /viewjob entry without a fromjk to compare: drop it when it repeats another entry's
    # title, company, location and pay.
    shown = {_card(r) for r, u in zip(rows, unchecked) if not u}
    return [r for r, u in zip(rows, unchecked) if not (u and _card(r) in shown)]


def _card(row):
    return (row["title"], row["company"], row["location"], row["pay"])


# ---------------------------------------------------------------- Glassdoor

GD_LINK = re.compile(r"^\[(?P<title>.+?)\]\((?P<url>https://www\.glassdoor\.com/job-listing/[^)\s?]+)\?(?:[^)\s]*&)?jl=(?P<id>\d+)[^)\s]*\)$")
GD_RATING = re.compile(r"^\d(?:\.\d)?$")
GD_PAY = re.compile(r"^\$\d")
GD_NOT_LOCATION = re.compile(r"^(?:\$|Skills:|Easy Apply$|Best Places to Work$|\[)")
GD_ESTIMATE = "(Glassdoor est.)"
GD_PARTNER = re.compile(r"/partner/jobListing\.htm\?([^)\s]*)")
GD_LISTING_ID = re.compile(r"(?:^|&)jobListingId=(\d+)(?:&|$)")
GD_JRTK = re.compile(r"(?:^|&)jrtk=[^&]*-([0-9a-f]{16})(?:&|$)")


def glassdoor_twins(lines):
    """{Glassdoor job id: Indeed jk} from the partner links on the page (first link wins)."""
    twins = {}
    for line in lines:
        for m in GD_PARTNER.finditer(line):
            jl, jk = GD_LISTING_ID.search(m.group(1)), GD_JRTK.search(m.group(1))
            if jl and jk and jl.group(1) not in twins:
                twins[jl.group(1)] = jk.group(1)
    return twins


def parse_glassdoor(md):
    lines = clean_lines(md)
    twins = glassdoor_twins(lines)
    rows = []
    for i, line in enumerate(lines):
        m = GD_LINK.match(line)
        if not m:
            continue
        j = i - 1
        rating = None
        if j >= 0 and GD_RATING.match(lines[j]):
            rating = float(lines[j])
            j -= 1
        company = lines[j] if j >= 0 else None
        if company and company.endswith(" Logo"):
            company = company[: -len(" Logo")]       # company line missing, logo alt has the name
        if company and (company.startswith("[") or GD_LINK.match(company)):
            company = None
        k = i + 1
        location = lines[k] if k < len(lines) else None
        if location and (len(location) > 60 or location.endswith(("\u2026", "...")) or GD_NOT_LOCATION.match(location)):
            location = None                           # missing: the next line is pay, a badge or the snippet
        else:
            k += 1
        pay = lines[k] if k < len(lines) and GD_PAY.match(lines[k]) and len(lines[k]) < 80 else None
        # '(Glassdoor est.)' is Glassdoor's guess at a full-time salary, not the intern pay, so it
        # gets no hourly number: it does not sort, filter or win a merge like employer pay.
        estimate = pay is not None and GD_ESTIMATE in pay
        rows.append({
            "source": "glassdoor",
            "title": m.group("title").strip(),
            "company": company,
            "location": location,
            "pay": pay,
            "pay_hourly_min": None if estimate else pay_hourly_min(pay),
            "rating": rating,
            "url": f"{m.group('url')}?jl={m.group('id')}",
            "job_id": m.group("id"),
            "indeed_jk": twins.get(m.group("id")),
        })
    return rows


PARSERS = {"indeed": parse_indeed, "glassdoor": parse_glassdoor}
