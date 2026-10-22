# Setup (about 10 minutes, do it before the workshop)

Workshop: "The Unfair Advantage: Live Web Data", Cal Hacks 13.

You need:

- Claude Code or Cursor, installed and signed in.
- Node 22 or newer (`node --version`). Every card builds a small Node app with no `npm install`.
  The apps run on Node 20 too, but the agent skills installer in step 4 needs Node 22.
- git.
- Python 3 only if you want to run `examples/intern-intel/` in Python.

---

## 1. Your Bright Data API key

1. Your API keys are under Account settings > API keys: https://brightdata.com/cp/setting/users
2. No key there, or lost it? Create one on the same page:
   - Click **Add API key** (top right of the API key section).
   - Choose the user, the permissions and an expiration date (or Unlimited), then click **Save**.
   - Copy the key right away. It is shown once. If you lose it, create a new one.
   - Only account admins can create API keys.

Treat the key like a password. Do not paste it into a chat, a screenshot, a commit or a shared screen.

---

## 2. Get the repo and add your key

```
git clone https://github.com/ScrapeAlchemist/public-data-hackpack.git
cd public-data-hackpack
```

Copy `.env.example` to `.env` in the repo root and fill it in:

```
BRIGHTDATA_API_TOKEN=your key here
BRIGHTDATA_ZONE=
```

- `.env` is in `.gitignore`. Never commit it.
- The code also accepts the name `BRIGHTDATA_API_KEY`.
- `BRIGHTDATA_ZONE` can stay empty. The code then lists your zones and picks one with the type
  `unblocker` (a Web Unlocker zone). Fetching pages and Google results needs one.
- No Web Unlocker zone on your account? Connecting the hosted MCP server once (step 3) creates
  one named `mcp_unlocker`. Or add a Web Unlocker zone in the Bright Data control panel.

---

## 3. Connect the Bright Data MCP server (for exploring)

The apps you build call the Bright Data REST API from their own server code, so they run
without the agent. The MCP server is for you and your agent while you explore: find a scraper,
look at a page, try a search.

The hosted server is one URL. Replace `YOUR_API_KEY` with your key:

```
https://mcp.brightdata.com/mcp?token=YOUR_API_KEY
```

### Claude Code

From the repo folder:

```
claude mcp add --transport http brightdata "https://mcp.brightdata.com/mcp?token=YOUR_API_KEY"
```

- Keep the double quotes. On macOS zsh, an unquoted `?` fails with "no matches found".
- `--transport http` is required. Without it, Claude Code treats the URL as a local command.
- The default scope is `local`. With `--scope project`, Claude Code writes the URL, key included,
  into `.mcp.json`. This repo's `.gitignore` ignores `.mcp.json`. Keep it that way.

### Cursor

Add a remote (HTTP) MCP server named `brightdata` with the URL above in Cursor's MCP settings.
We have not tested Cursor with this workshop. If you use a project-level `.cursor/mcp.json`, it
holds your key; this repo's `.gitignore` ignores `.cursor/`.

Skip the Bright Data Cursor plugin for now: its last update (2026-04-05) names tools the server
has since removed.

### What you get

Measured on 2026-10-19, the hosted server has 31 tools, all on by default. The ones the cards use:

- `search_engine`, `scrape_as_markdown`, `scrape_as_html`: search and fetch any public page.
- `search_scrapers`, `get_scraper_details`, `run_scraper`, `get_scraper_progress`,
  `get_scraper_results`: find a site's scraper and run it for structured records.
- `list_dataset_fields`, `search_dataset`: query a pre-collected dataset (LinkedIn companies and
  people, for example).

You do not need any flags. Old guides mention `PRO_MODE` or `&pro=1` (no longer does anything)
and `&groups=...`. Do not add `&groups=scrapers`: it cuts the server to 9 tools and drops
`search_dataset`.

---

## 4. Bright Data agent skills

https://github.com/brightdata/skills has everything your agent needs to use Bright Data's tools:
21 skills covering the MCP server, the CLI, Web Unlocker, the SERP API, the Web Scraper API, the
Browser API, proxies, and the Python and JavaScript SDKs. From the repo folder:

```
npx skills add brightdata/skills
```

In our test (2026-10-20) it installed all 21 skills for Claude Code into `.claude/skills/` and
wrote `skills-lock.json` in the repo folder. The installer asks for Node 22.20 or newer. On Node
22.16 npm printed a warning and the install still worked. On Node 20 it stopped with a
`SyntaxError` before installing anything: update Node and run it again.

The cards carry their own measured routes, so each card works with or without the skills. For
anything a card does not cover, the skills are where your agent finds how to do it.

Once installed, the `bright-data-mcp` skill makes Bright Data your agent's default tool for web
search and fetch in this project.

---

## 5. Smoke test

From the repo root:

```
node ideas/01-crm-autofill/enrich.mjs "Jensen Huang" "NVIDIA"
```

- Expected: a JSON record with `person.followers` (an exact number), the company's
  `employees_on_linkedin` and `headquarters`, and `checks.name_match` set to `true`.
- It took 15 to 57 seconds per person in our tests on 2026-10-19. If Google keeps refusing, the
  script falls back to LinkedIn's people search scraper, which adds one to three minutes.
- "Set BRIGHTDATA_API_TOKEN in .env" means step 2 is not done. "No Web Unlocker zone" means you
  need a zone (end of step 2). These errors, and an HTTP 401 or 403 from Bright Data (a wrong
  key, or a key without permission), stop the script right away; it does not fall back for them.

To check the MCP connection, paste this into your agent:

```
Use the Bright Data search_scrapers tool to find the scraper for LinkedIn company pages and tell me its dataset id.
```

Expected: `gd_l1vikfnt1wgvvqz95w` ("LinkedIn company information"). If the agent answers from
memory or says it cannot reach Bright Data, the MCP server is not connected. Go back to step 3.

You are ready. Pick a card in [README.md](README.md).
