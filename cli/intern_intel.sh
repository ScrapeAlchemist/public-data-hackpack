#!/usr/bin/env bash
# Intern Intel with the Bright Data CLI (macOS, Linux, or Git Bash on Windows).
#
#   ./cli/intern_intel.sh
#   ./cli/intern_intel.sh --role "data science intern" --location "New York, NY"
#   ./cli/intern_intel.sh --pages 2 --min-hourly 40 --limit 20
#
# Three steps:
#   1. python/intern_intel.py --print-urls      builds the Indeed and Glassdoor search URLs
#   2. the Bright Data CLI fetches each page as markdown, all pages at the same time:
#        npx -y @brightdata/cli@0.4.0 scrape <url> -f markdown --country us --zone <zone> -o <file>
#   3. python/intern_intel.py --from-dir <folder>  parses, merges, removes duplicates, filters,
#      and writes out/intern_intel.csv and out/intern_intel.json
#
# Options: --role, --location, --pages (1 or 2), --zone, --timeout (seconds, default 180:
# pages still running after that count as failed). Anything else (--title-includes,
# --location-includes, --min-hourly, --limit) goes to step 3 unchanged. There is no
# --offline or --refresh here: use python/intern_intel.py or js/intern_intel.mjs for those.
#
# You need Node.js 20 or newer (for npx), Python 3 with python/requirements.txt installed
# (steps 1 and 3 run the Python version; the repo's .venv is used by itself), and a Bright
# Data API key. Nothing is installed globally: npx keeps the CLI in its own cache.
#
# API key: BRIGHTDATA_API_KEY or BRIGHTDATA_API_TOKEN, from your environment or the .env file
# in the repo root. The CLI reads the name BRIGHTDATA_API_KEY, so this script exports it for
# its own process only.
# Zone: --zone, else BRIGHTDATA_UNLOCKER_ZONE or BRIGHTDATA_ZONE, else the first Web Unlocker
# zone on your account (found with "npx -y @brightdata/cli@0.4.0 zones --json").

set -euo pipefail

CLI_PACKAGE="@brightdata/cli@0.4.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
started=$SECONDS

role="software engineer intern"
location="San Francisco, CA"
pages=1
zone=""
timeout=180
extra=()
while [ $# -gt 0 ]; do
  case "$1" in
    --role) role="$2"; shift 2 ;;
    --location) location="$2"; shift 2 ;;
    --pages) pages="$2"; shift 2 ;;
    --zone) zone="$2"; shift 2 ;;
    --timeout) timeout="$2"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) extra+=("$1"); shift ;;
  esac
done
case "$pages" in 1|2) ;; *) echo "--pages must be 1 or 2"; exit 1 ;; esac
case "$timeout" in ''|*[!0-9]*) echo "--timeout must be a number of seconds"; exit 1 ;; esac

dotenv() {  # the value of $1 in the repo .env file, or nothing
  [ -f "$ROOT/.env" ] || return 0
  sed -n -E "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" | head -n 1 | tr -d '\r' \
    | sed -E 's/[[:space:]]+$//; s/^"(.*)"$/\1/'"; s/^'(.*)'\$/\\1/"
}

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found. Install Node.js 20 or newer from nodejs.org, then open a new terminal."
  exit 1
fi

# Python: $PYTHON, else the repo's .venv, else python3 or python on the PATH.
if [ -n "${PYTHON:-}" ]; then py="$PYTHON"
elif [ -x "$ROOT/.venv/bin/python" ]; then py="$ROOT/.venv/bin/python"
elif [ -x "$ROOT/.venv/Scripts/python.exe" ]; then py="$ROOT/.venv/Scripts/python.exe"
elif command -v python3 >/dev/null 2>&1; then py="python3"
else py="python"
fi
intel="$ROOT/python/intern_intel.py"

# ------------------------------------------------------------------ API key and zone
key="${BRIGHTDATA_API_KEY:-${BRIGHTDATA_API_TOKEN:-}}"
[ -n "$key" ] || key="$(dotenv BRIGHTDATA_API_KEY)"
[ -n "$key" ] || key="$(dotenv BRIGHTDATA_API_TOKEN)"
if [ -z "$key" ]; then
  echo "No Bright Data API key. Put BRIGHTDATA_API_TOKEN=... in .env (see .env.example)."
  exit 1
fi
export BRIGHTDATA_API_KEY="$key"   # this process and its children only; never printed
unset key

[ -n "$zone" ] || zone="${BRIGHTDATA_UNLOCKER_ZONE:-${BRIGHTDATA_ZONE:-}}"
[ -n "$zone" ] || zone="$(dotenv BRIGHTDATA_ZONE)"
if [ -z "$zone" ]; then
  # The CLI does not pick a zone by itself (only "bdata login" sets a default), so we look one up.
  if ! zones_json="$(npx -y "$CLI_PACKAGE" zones --json)"; then
    echo "Could not list your zones with the Bright Data CLI (see the message above)."
    exit 1
  fi
  names="$(printf '%s' "$zones_json" | "$py" -c 'import json, sys
print(" ".join(sorted(z["name"] for z in json.load(sys.stdin) if z.get("type") == "unblocker")))' | tr -d '\r')"
  if [ -z "$names" ]; then
    echo "No Web Unlocker zone on this account. Create one in the Bright Data control panel, then set BRIGHTDATA_ZONE=<its name> in .env."
    exit 1
  fi
  zone="${names%% *}"
  echo "Zone not set, using Web Unlocker zone '$zone' (found: $names)"
else
  # Also installs the CLI into the npx cache before the parallel step.
  echo "Bright Data CLI $(npx -y "$CLI_PACKAGE" --version), zone '$zone'"
fi
export BRIGHTDATA_ZONE="$zone"   # step 1 may need it for a Glassdoor location lookup

# ------------------------------------------------------------------ 1. URLs
plan="$("$py" "$intel" --print-urls --role="$role" --location="$location" --pages="$pages" | tr -d '\r')"
srcs=(); nums=(); urls=()
while IFS=$'\t' read -r src num url; do
  case "$src" in
    indeed|glassdoor) srcs+=("$src"); nums+=("$num"); urls+=("$url") ;;
    "") ;;
    *) echo "$src${num:+ $num}${url:+ $url}" ;;   # e.g. "[glassdoor] skipped: ..."
  esac
done <<< "$plan"
if [ ${#urls[@]} -eq 0 ]; then
  echo "Could not build the search URLs."
  exit 1
fi

# ------------------------------------------------------------------ 2. fetch with the CLI
slug="$(printf '%s %s p%s' "$role" "$location" "$pages" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
out_dir="$ROOT/cache/cli/$slug"
mkdir -p "$out_dir"
rm -f "$out_dir"/*.md "$out_dir"/*.log "$out_dir"/*.status   # old pages from an earlier run of the same search

scrape() {  # url file: fetch one page; writes <file>.log and <file>.status ("<exit code> <seconds>")
  local t0=$SECONDS code=0 child
  npx -y "$CLI_PACKAGE" scrape "$1" -f markdown --country us --zone "$zone" -o "$2" >"$2.log" 2>&1 &
  child=$!
  trap 'kill "$child" 2>/dev/null; exit 143' TERM   # on timeout, stop the CLI too
  wait "$child" || code=$?
  trap - TERM
  echo "$code $((SECONDS - t0))" > "$2.status"
}

echo "Fetching ${#urls[@]} pages with the Bright Data CLI (a page can take over a minute; the limit is $timeout s) ..."
pids=()
for i in "${!urls[@]}"; do
  scrape "${urls[$i]}" "$out_dir/${srcs[$i]}_p${nums[$i]}.md" &
  pids+=($!)
  sleep 0.1   # space out the request starts
done
fetch_started=$SECONDS
next_note=$((SECONDS + 15))
while :; do
  waiting=""
  for i in "${!pids[@]}"; do
    if kill -0 "${pids[$i]}" 2>/dev/null; then waiting="$waiting${waiting:+, }${srcs[$i]} p${nums[$i]}"; fi
  done
  [ -n "$waiting" ] || break
  if [ $((SECONDS - fetch_started)) -ge "$timeout" ]; then
    for i in "${!pids[@]}"; do
      if kill -0 "${pids[$i]}" 2>/dev/null; then
        kill "${pids[$i]}" 2>/dev/null || true
        file="$out_dir/${srcs[$i]}_p${nums[$i]}.md"
        echo "-1 $timeout" > "$file.status"
        echo "No answer within $timeout s. Run the script again, or raise --timeout." > "$file.log"
      fi
    done
    break
  fi
  if [ $SECONDS -ge $next_note ]; then
    echo "  still waiting for $waiting ($((SECONDS - fetch_started)) s so far)"
    next_note=$((SECONDS + 15))
  fi
  sleep 1
done
for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done

status() {  # sets code and secs from <file>.status
  code=1; secs="?"
  if [ -f "$1.status" ]; then read -r code secs < "$1.status" || true; fi
}

for i in "${!urls[@]}"; do
  file="$out_dir/${srcs[$i]}_p${nums[$i]}.md"
  status "$file"
  if [ "$code" = "-1" ]; then rm -f "$file"; fi   # timed out: never parse a half-written page
  if [ "$code" = "0" ] && [ ! -s "$file" ]; then
    # An empty answer is worth exactly one more try. Errors (bad key, bad zone, login wall) are not.
    scrape "${urls[$i]}" "$file"
    status "$file"
  fi
  if [ "$code" = "0" ] && [ -s "$file" ]; then
    echo "[${srcs[$i]} p${nums[$i]}] $(wc -c < "$file" | tr -d ' ') bytes in ${secs} s"
  else
    rm -f "$file"
    echo "[${srcs[$i]} p${nums[$i]}] FAILED after ${secs} s (exit code $code):"
    cat "$file.log"
  fi
done

# ------------------------------------------------------------------ 3. parse, merge, filter
echo
code=0
"$py" "$intel" --from-dir="$out_dir" ${extra[@]+"${extra[@]}"} || code=$?
echo "Total $((SECONDS - started)) s (pages saved in $out_dir)"
exit $code
