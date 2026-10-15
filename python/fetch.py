"""Fetch public pages as markdown through the Bright Data Web Unlocker REST API.

Why plain `requests` and not the brightdata-sdk package: the Python SDK (2.5.2) only
returns raw HTML or JSON from the Web Unlocker. Indeed and Glassdoor search pages are
about 1 MB of HTML each, but under 70 KB as markdown, and the markdown is what the parsers
read. The REST call below is one POST with data_format="markdown".

  POST https://api.brightdata.com/request
  {"zone": <Web Unlocker zone>, "url": <page>, "format": "raw", "data_format": "markdown", "country": "us"}

Behaviour:
- Token from BRIGHTDATA_API_TOKEN (or BRIGHTDATA_API_KEY), from the environment or the repo-root .env.
- Zone from BRIGHTDATA_ZONE. If it is empty, we list the account's zones once and use a
  Web Unlocker ("unblocker") zone.
- Cache: cache/<sha1(url)>.md, reused while younger than 6 hours. If the network fails and an
  older cached copy exists, that copy is used and the result says so.
- Offline: pages come only from fixtures/ (via fixtures/manifest.json). No network, no token.
- Several URLs run in parallel (at most 6), with request starts at least 50 ms apart.
- One retry for an empty body, a timeout or a 5xx. No retry for a login wall or a 4xx.

Only the network path needs the packages in requirements.txt. --offline, --from-dir and
--print-urls (for the saved locations) run on the standard library alone.
"""

import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "cache"
FIXTURES_DIR = REPO_ROOT / "fixtures"
API_URL = "https://api.brightdata.com/request"
ZONES_URL = "https://api.brightdata.com/zone/get_active_zones"
CACHE_MAX_AGE_S = 6 * 3600
MAX_PARALLEL = 6
MIN_START_GAP_S = 0.05
TIMEOUT = (15, 180)  # connect, read. Glassdoor pages took over 40 s in testing.

class FetchError(Exception):
    pass


def _load_env_file(path):
    """Load .env with python-dotenv, or with a small KEY=VALUE reader if it is not installed."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        if not path.exists():
            return
        for raw in read_text(path).splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = (part.strip() for part in line.removeprefix("export ").split("=", 1))
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            elif " #" in value:
                value = value.split(" #", 1)[0].rstrip()
            os.environ.setdefault(key, value)
        return
    load_dotenv(path)


def _requests():
    """The requests package, imported on first use so offline runs do not need it."""
    try:
        import requests
    except ImportError as e:
        raise FetchError("The network path needs the requests package: run "
                         "pip install -r python/requirements.txt in your venv, or use --offline.") from e
    return requests


@dataclass
class Page:
    url: str
    text: str = ""
    origin: str = ""        # network | cache | stale-cache | fixture
    seconds: float = 0.0
    error: str = ""

    @property
    def ok(self):
        return not self.error


# ---------------------------------------------------------------- credentials

def _token():
    tok = (os.environ.get("BRIGHTDATA_API_TOKEN") or os.environ.get("BRIGHTDATA_API_KEY") or "").strip()
    if not tok:
        raise FetchError("No Bright Data API key. Put BRIGHTDATA_API_TOKEN=... in .env "
                         "(see .env.example), or run with --offline.")
    return tok


_zone_lock = threading.Lock()
_zone_cache = []


def _zone():
    """BRIGHTDATA_ZONE, or a Web Unlocker zone found on the account."""
    zone = os.environ.get("BRIGHTDATA_ZONE", "").strip()
    if zone:
        return zone
    with _zone_lock:
        if not _zone_cache:
            _zone_cache.append(_discover_unlocker_zone())
        return _zone_cache[0]


def _discover_unlocker_zone():
    requests = _requests()
    try:
        r = requests.get(ZONES_URL, headers={"Authorization": f"Bearer {_token()}"}, timeout=TIMEOUT)
    except requests.exceptions.RequestException as e:
        raise FetchError(f"Could not reach Bright Data to list your zones ({type(e).__name__}).") from e
    _raise_for_auth(r)
    if r.status_code != 200:
        raise FetchError(f"Could not list your zones (HTTP {r.status_code}). Set BRIGHTDATA_ZONE in .env.")
    names = sorted(z.get("name") for z in r.json() if z.get("type") == "unblocker" and z.get("name"))
    if not names:
        raise FetchError("No Web Unlocker zone on this account. Create one in the Bright Data "
                         "control panel, then set BRIGHTDATA_ZONE=<its name> in .env.")
    print(f"[fetch] BRIGHTDATA_ZONE not set, using Web Unlocker zone '{names[0]}' "
          f"(found: {', '.join(names)})")
    return names[0]


def _raise_for_auth(r):
    if r.status_code == 401:
        raise FetchError("Bright Data rejected the API key (HTTP 401). Check BRIGHTDATA_API_TOKEN.")
    if r.status_code == 403:
        raise FetchError("The API key is valid but lacks permission for this zone or product (HTTP 403).")


# ---------------------------------------------------------------- network

_pace_lock = threading.Lock()
_last_start = [0.0]


def _pace():
    with _pace_lock:
        wait = MIN_START_GAP_S - (time.monotonic() - _last_start[0])
        if wait > 0:
            time.sleep(wait)
        _last_start[0] = time.monotonic()


def _post_once(url, markdown):
    requests = _requests()
    body = {"zone": _zone(), "url": url, "format": "raw", "country": "us"}
    if markdown:
        body["data_format"] = "markdown"
    _pace()
    r = requests.post(API_URL, json=body, timeout=TIMEOUT,
                      headers={"Authorization": f"Bearer {_token()}"})
    # The body is UTF-8 but the Content-Type has no charset, so decode it ourselves.
    return r, r.content.decode("utf-8", errors="replace")


def fetch_network(url, markdown=True):
    """One page from Bright Data. Returns the text or raises FetchError."""
    requests = _requests()
    last = ""
    for attempt in (1, 2):
        try:
            r, text = _post_once(url, markdown)
        except requests.exceptions.RequestException as e:
            last = f"network error: {type(e).__name__}"
            continue
        _raise_for_auth(r)
        brd_error = r.headers.get("x-brd-error-code", "") or ""
        if r.status_code == 200 and text.strip():
            return text
        if "reject_" in brd_error:
            # e.g. reject_authwall: the site showed a login page. Retrying will not help.
            raise FetchError(f"blocked by the site ({brd_error}): {r.headers.get('x-brd-error', '')}".strip())
        if 400 <= r.status_code < 500:
            hint = ""
            if "zone" in text.lower() and "not found" in text.lower():
                hint = " Check BRIGHTDATA_ZONE in .env."
            raise FetchError(f"HTTP {r.status_code}: {text.strip()[:200]}{hint}")
        last = (f"empty response (HTTP {r.status_code})" if r.status_code == 200
                else f"HTTP {r.status_code} {brd_error}".strip())
    raise FetchError(f"{last}, after one retry")


# ---------------------------------------------------------------- cache and fixtures

def cache_path(url, markdown=True):
    return CACHE_DIR / (hashlib.sha1(url.encode("utf-8")).hexdigest() + (".md" if markdown else ".json"))


def read_text(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


_load_env_file(REPO_ROOT / ".env")


def fixture_manifest():
    path = FIXTURES_DIR / "manifest.json"
    if not path.exists():
        return {}
    return json.loads(read_text(path))["pages"]


def fetch_one(url, markdown=True, refresh=False, offline=False):
    """Get one page. Never raises: errors come back in Page.error."""
    t0 = time.monotonic()
    page = Page(url)
    try:
        if offline:
            entry = fixture_manifest().get(url)
            if entry is None:
                raise FetchError("no fixture for this URL (offline mode only has the queries in fixtures/manifest.json)")
            page.text, page.origin = read_text(FIXTURES_DIR / entry["file"]), "fixture"
            return page
        path = cache_path(url, markdown)
        if not refresh and path.exists() and time.time() - path.stat().st_mtime < CACHE_MAX_AGE_S:
            page.text, page.origin = read_text(path), "cache"
            return page
        try:
            page.text, page.origin = fetch_network(url, markdown), "network"
            write_text(path, page.text)
        except FetchError:
            if path.exists():  # bad WiFi or a slow site: an old copy beats nothing
                page.text, page.origin = read_text(path), "stale-cache"
            else:
                raise
    except FetchError as e:
        page.error = str(e)
    finally:
        page.seconds = round(time.monotonic() - t0, 1)
    return page


def fetch_many(urls, markdown=True, refresh=False, offline=False):
    """Fetch several pages in parallel. Returns Pages in the same order as urls."""
    if not urls:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(urls))) as pool:
        return list(pool.map(lambda u: fetch_one(u, markdown, refresh, offline), urls))
