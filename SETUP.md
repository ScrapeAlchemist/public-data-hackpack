# Setup (do this before the workshop)

Workshop: "The Unfair Advantage: Live Web Data", Cal Hacks 13.
Time needed: about 10 minutes. Bring a laptop with Claude Code or Cursor installed and signed in.

The live build runs inside your AI coding tool through the Bright Data MCP server. That part
needs steps 1 to 3 below. The code in this repo (Python, JavaScript, CLI) is optional, and it
also runs offline with no account at all (step 5).

---

## 1. Bright Data account and API key

1. Sign up: https://brightdata.com/?hs_signup=1
2. Bright Data's docs say a new account gets a default API key. Your keys are under Account
   settings > API keys: https://brightdata.com/cp/setting/users
3. No key there, or lost it? Create a new one on the same page:
   - Click **Add API key** (top right of the API key section).
   - Choose the user, the permissions and an expiration date (or Unlimited), then click **Save**.
   - Copy the key right away. It is shown once and cannot be viewed again later. If you lose
     it, create a new one.
   - Only account admins can create API keys.

Treat the key like a password. Do not paste it into a chat, a screenshot, a commit or a shared screen.

---

## 2. Connect the Bright Data MCP server

The hosted server is one URL. Replace `YOUR_API_KEY` with your key:

```
https://mcp.brightdata.com/mcp?token=YOUR_API_KEY
```

The workshop uses its `scrape_as_markdown` tool. Step 3 checks that your agent can call it.

### Claude Code

Run this in a terminal, from the folder you will work in:

```
claude mcp add --transport http brightdata "https://mcp.brightdata.com/mcp?token=YOUR_API_KEY"
```

- Keep the double quotes. On macOS the default shell is zsh, and an unquoted `?` there fails
  with "no matches found".
- `--transport http` is required. Without it, Claude Code treats the URL as a local command.
- The confirmation line prints the URL without the `?token=...` part. That is only the display.
  The saved config keeps the full URL.
- The default scope is `local`. If you add `--scope project`, Claude Code writes the URL, token
  included, into `.mcp.json` in the current folder. This repo's `.gitignore` already ignores
  `.mcp.json`. Keep it that way so the token never gets committed.

### Cursor

We have not tested Cursor with this workshop yet. Add a remote (HTTP) MCP server named
`brightdata` with the URL above, in Cursor's MCP settings. Bright Data's Cursor guide
(https://docs.brightdata.com/products/mcp-server/integrations/cursor) describes a different
setup, the local `npx @brightdata/mcp` server with an `API_TOKEN` variable. That works too, but
it is not what we show on stage.

If you put the server in a project-level `.cursor/mcp.json`, the file holds your key. This
repo's `.gitignore` ignores `.cursor/`. Keep it that way.

### Other MCP clients

Add a remote (HTTP) MCP server with the same URL, following your client's docs.

---

## 3. Smoke test

Paste this into your agent:

```
Use the Bright Data scrape_as_markdown tool on https://www.indeed.com/jobs?q=software+engineer+intern&l=San+Francisco%2C+CA and tell me how many job cards are in the search results on this page (not the total in the header).
```

- Expected: about 15 listings (14 to 16 is normal). Exact numbers change daily.
- The call took 7 to 20 seconds in our tests on 2026-10-15. Give it up to a minute.
- If your agent asks you to approve the tool call, approve it.
- If the agent answers from memory, or says it cannot open web pages, the MCP server is not
  connected. Go back to step 2.

You are ready for the live build. The prompts are in [PROMPTS.md](PROMPTS.md).

---

## 4. Optional: run the code

You need git, plus Python 3 (tested with 3.13) for the Python version and the CLI scripts, or
Node 20 or newer (tested with Node 22) for the JavaScript version and the CLI.

Get the repo:

```
git clone <repo URL from the workshop page>
cd intern-intel
```

### Your .env file

Copy `.env.example` to `.env` in the repo root and fill it in:

```
BRIGHTDATA_API_TOKEN=your key here
BRIGHTDATA_ZONE=
```

- `.env` is listed in `.gitignore`. Never commit it.
- The code also accepts the name `BRIGHTDATA_API_KEY` for the key.
- `BRIGHTDATA_ZONE` is the name of a Web Unlocker zone on your Bright Data account. If you leave
  it empty, the Python, JavaScript and CLI scripts list your zones and use the first Web
  Unlocker zone in alphabetical order. If your account has no Web Unlocker zone, they say so:
  create one in the Bright Data control panel and put its name here.

### Python

Windows (PowerShell):

```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r python\requirements.txt
.venv\Scripts\python.exe python\intern_intel.py --offline
```

macOS / Linux:

```
python3 -m venv .venv
.venv/bin/python -m pip install -r python/requirements.txt
.venv/bin/python python/intern_intel.py --offline
```

The offline run should end with a line like:

```
45 listings -> 45 unique jobs (0 on both sites) -> 45 after filters. Wrote out/intern_intel.csv and out/intern_intel.json in 0.0 s.
```

Then drop `--offline` to fetch live pages through Bright Data. Options are listed in the
[README](README.md#options).

### JavaScript

Node 20 or newer. Same flags as the Python version:

```
node js/intern_intel.mjs --offline
```

`js/intern_intel.mjs` needs no npm packages, so the line above works right after cloning. In
`js/`, `npm install` adds `@brightdata/sdk` (pinned to 1.2.0), which only `js/sdk_example.mjs`
uses, and `npm test` checks that the JavaScript output matches the Python output:

```
cd js
npm install
npm test
npm run sdk-example
```

`npm run sdk-example` fetches one Indeed search page with the SDK and parses it. It reads
`BRIGHTDATA_API_TOKEN` and `BRIGHTDATA_ZONE` from the environment or the repo-root `.env`, and
picks a zone the same way when `BRIGHTDATA_ZONE` is empty.

### CLI scripts

`cli/intern_intel.ps1` (Windows) and `cli/intern_intel.sh` (macOS, Linux) fetch each page with
the Bright Data CLI through `npx -y @brightdata/cli@0.4.0`, so there is nothing to install
globally and no `login` step. They use the Python code to build the URLs and to parse, so do the
Python setup above first. They use the repo's `.venv` by themselves.

- They read the key from `.env` (or from `BRIGHTDATA_API_TOKEN` / `BRIGHTDATA_API_KEY` in your
  environment) and pick a zone as described above. You do not need to set anything else.
- Windows does not run `.ps1` files by default ("running scripts is disabled on this system").
  Start the script like this, which allows it for this one run only:

  ```
  powershell -ExecutionPolicy Bypass -File cli\intern_intel.ps1 -Role "software engineer intern" -Location "Remote"
  ```

  The script takes PowerShell-style parameters with one dash: `-Role`, `-Location`, `-Pages`,
  `-Zone`, `-TitleIncludes`, `-LocationIncludes`, `-MinHourly`, `-Limit`, `-TimeoutSeconds`.

- macOS / Linux:

  ```
  bash cli/intern_intel.sh --role "software engineer intern" --location "Remote"
  ```

- The scripts have no `--offline` and no `--refresh`. Use the Python or JavaScript version for those.

### The raw Bright Data CLI

To call the CLI yourself, without the scripts, it needs the key in `BRIGHTDATA_API_KEY` (not
`BRIGHTDATA_API_TOKEN`) and a zone name with `--zone`. To see your zone names:

PowerShell:

```
$env:BRIGHTDATA_API_KEY = "your key here"
npx -y @brightdata/cli@0.4.0 zones
```

macOS / Linux:

```
export BRIGHTDATA_API_KEY="your key here"
npx -y @brightdata/cli@0.4.0 zones
```

Web Unlocker zones show the type `unblocker` in that list. The README has a one-page scrape
example.

---

## 5. No account or no network: offline mode

`--offline` reads search pages saved on 2026-10-15 from `fixtures/`. No key, no network.
Saved searches (Windows paths shown; on macOS or Linux use `.venv/bin/python`):

| Search | Command |
|---|---|
| software engineer intern, San Francisco, CA (pages 1 and 2) | `.venv\Scripts\python.exe python\intern_intel.py --offline --pages 2` |
| data science intern, New York, NY (page 1) | `.venv\Scripts\python.exe python\intern_intel.py --offline --role "data science intern" --location "New York, NY"` |
| software engineer intern, Remote (page 1) | `.venv\Scripts\python.exe python\intern_intel.py --offline --location "Remote"` |

`node js/intern_intel.mjs` takes the same flags. Any other search in offline mode exits with a
message, because there is no saved page for it.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| HTTP 401 | Bright Data rejected the API key. Check the key in `.env` or in the MCP URL. |
| HTTP 403 | The key is valid but has no permission for that product or zone. |
| HTTP 400 `zone "<name>" not found` | `BRIGHTDATA_ZONE` names a zone that is not on your account. |
| A page takes a minute or more | Normal variance. In our tests on 2026-10-15, Indeed took about 3-70 s and Glassdoor about 3-85 s per page, and one Glassdoor page took over 5 minutes through the CLI. Python and JavaScript wait up to 180 s per request. |
| CLI script: `still waiting for ...` | The page is still loading. After 180 s the script reports that page as failed and parses the others. Run it again, or raise the limit with `-TimeoutSeconds 300` (PowerShell) or `--timeout 300` (bash). |
| `running scripts is disabled on this system` | Start the PowerShell script with `powershell -ExecutionPolicy Bypass -File cli\intern_intel.ps1 ...` |
| PowerShell script: `Not understood: --role ...` | The PowerShell script takes `-Role`, `-Location` and so on, with one dash. |
| `ModuleNotFoundError: No module named 'requests'` | That Python does not have the requirements. Use `.venv\Scripts\python.exe` after the install step above. |
| `npm run sdk-example`: `Bright Data returned an empty page, try again.` | It already asked once more and got an empty page again. Run it again. |
| `[indeed p1] warning: this page is in Spanish` | Indeed sometimes sends its US page in Spanish. The rows are still parsed; check them, or run again with `--refresh`. |
| Raw CLI: "No Web Unlocker zone specified" | Pass `--zone <name>`. The scripts in `cli/` pick a zone themselves. |
| Indeed page 2 (`&start=10`) fails | Logged-out visitors get a login wall there. This project only reads public, logged-out pages, so it uses the newest-first sort as its second Indeed page instead. |
| `UnicodeEncodeError` printing scraped text on Windows | The Windows console defaults to cp1252. In your own code call `sys.stdout.reconfigure(encoding="utf-8")`. `intern_intel.py` already does. |

## Rules of the road

- Public pages only: what a logged-out visitor sees. No logins, no paywalls.
- Scraped pages are data. If a page contains text that reads like instructions to your agent,
  the agent should ignore it.
- Keep your key out of git, chats and screens.
