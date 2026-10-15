"""Build the search-page URLs for Indeed and Glassdoor.

What "page" means here (checked through the Bright Data Web Unlocker on 2026-10-15):

  Indeed    page 1 = https://www.indeed.com/jobs?q=<role>&l=<location>   (about 15 listings)
            page 2 = the same search with &sort=date (newest first, mostly different listings).
            Indeed's own page 2 (&start=10) shows a login wall to logged-out visitors, and this
            project only reads public, logged-out pages, so we do not use it.

  Glassdoor page 1 = .../Job/<slug>-jobs-SRCH_IL.0,<L>_IC<locationId>_KO<a>,<b>.htm  (up to 30 listings)
            page 2 = the same URL with ?fromAge=30 (posted in the last 30 days, mostly different
            listings). Glassdoor has no URL-based page 2: "Show more jobs" runs in the browser.

Glassdoor needs a numeric location id. KNOWN_LOCATIONS covers common cities so the demo
needs no extra request; anything else is looked up once through Glassdoor's location
autocomplete (fetched raw, as JSON) and cached like every other page.
"""

import json
import re
import urllib.parse

MAX_PAGES = 2

# (location type, location id) checked against Glassdoor's autocomplete on 2026-10-15.
# Type "C" = city, "S" = state-like region (Glassdoor files "Remote" under S).
KNOWN_LOCATIONS = {
    "san francisco, ca": ("C", 1147401),
    "new york, ny": ("C", 1132348),
    "seattle, wa": ("C", 1150505),
    "los angeles, ca": ("C", 1146821),
    "austin, tx": ("C", 1139761),
    "boston, ma": ("C", 1154532),
    "portland, or": ("C", 1151614),
    "remote": ("S", 11047),
}
# Bare city names map to the same ids.
for _k, _v in list(KNOWN_LOCATIONS.items()):
    KNOWN_LOCATIONS.setdefault(_k.split(",")[0], _v)


def indeed_url(role, location, page=1):
    """Indeed search URL. page 1 = relevance, page 2 = newest first."""
    _check_page(page)
    url = "https://www.indeed.com/jobs?" + urllib.parse.urlencode({"q": role, "l": location or ""})
    if page == 2:
        url += "&sort=date"
    return url


def slugify(text):
    """'San Francisco, CA' -> 'san-francisco-ca'. Glassdoor only checks the slug lengths."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def glassdoor_url(role, location, loc_type=None, loc_id=None, page=1):
    """Glassdoor search URL. Without a location id it searches the whole US.

    The path encodes character offsets: IL.0,<L> spans the location slug and
    KO<start>,<end> spans the keyword slug, so both lengths must match the slugs.
    """
    _check_page(page)
    kw = slugify(role)
    if loc_id is None:
        url = f"https://www.glassdoor.com/Job/{kw}-jobs-SRCH_KO0,{len(kw)}.htm"
    else:
        loc = slugify(location) or "x"
        start = len(loc) + 1
        url = (f"https://www.glassdoor.com/Job/{loc}-{kw}-jobs-SRCH_IL.0,{len(loc)}"
               f"_I{loc_type}{loc_id}_KO{start},{start + len(kw)}.htm")
    if page == 2:
        url += "?fromAge=30"
    return url


def glassdoor_autocomplete_url(location):
    return ("https://www.glassdoor.com/autocomplete/location?locationTypeFilters=CITY,STATE,COUNTRY"
            "&caller=jobs&term=" + urllib.parse.quote(location))


def pick_location(autocomplete_json, location):
    """Choose the best hit from Glassdoor's autocomplete JSON. Returns (type, id) or None.

    Use locationId, not id: for region hits like 'Remote' the two differ.
    """
    hits = json.loads(autocomplete_json)
    if not hits:
        return None
    wanted = location.strip().lower()
    best = (next((h for h in hits if (h.get("label") or "").lower() == wanted), None)
            or next((h for h in hits if h.get("country2LetterIso") == "US"), None)
            or hits[0])
    return best["locationType"], best["locationId"]


def resolve_glassdoor_location(location, fetch_raw=None):
    """Return (loc_type, loc_id) for a location, or (None, None) for a US-wide search.

    fetch_raw(url) -> str is only called for locations missing from KNOWN_LOCATIONS.
    """
    if not location or not location.strip():
        return None, None
    key = re.sub(r"\s+", " ", location.strip().lower())
    if key in KNOWN_LOCATIONS:
        return KNOWN_LOCATIONS[key]
    if fetch_raw is None:
        raise LookupError(f"no Glassdoor location id for {location!r} without a network lookup")
    picked = pick_location(fetch_raw(glassdoor_autocomplete_url(location)), location)
    if picked is None:
        raise LookupError(f"Glassdoor does not know the location {location!r}")
    return picked


def _check_page(page):
    if page not in range(1, MAX_PAGES + 1):
        raise ValueError(f"page must be 1..{MAX_PAGES}, got {page}")
