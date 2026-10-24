# Set up the workshop

By the end of this guide, you'll have a page showing Reddit posts, X posts and
new GitHub projects.

**For the radar, do steps 1, 2 and 5.** Steps 3 and 4 add tools for your coding
agent and are optional. Already have the radar working? Go to [step 6](#6-in-the-workshop-your-own-subreddit-about-a-minute).

Before you start, install:

- **Node.js 22 or newer.** Run `node --version` to check.
- **Git.** Run `git --version` to check.
- **Claude Code or Cursor**, signed in, for the part where you build with an agent.

Run the commands below in a terminal. Keep that terminal in the
`public-data-hackpack` folder after you download it in step 2.

## 1. Your Bright Data API key

If you need an account, use the [Cal Hacks signup link](https://brightdata.com/?promo=calhack2026&hs_signup=1).
At the venue, use your phone's mobile data for signup.

1. Open [Account settings > API keys](https://brightdata.com/cp/setting/users).
2. Click **Add API key**, choose its settings, and save it. Only an account admin can create keys.
3. Copy the key when it appears. You'll put it in a file in the next step.

Keep the key private, like a password. Do not paste it into your coding agent or
show it on a shared screen. If you lose it, create a new one.

## 2. Get the repo and add your key

Download the project:

```sh
git clone https://github.com/ScrapeAlchemist/public-data-hackpack.git
cd public-data-hackpack
```

Copy the settings file:

```sh
cp .env.example .env
```

On Windows **Command Prompt**, use `copy .env.example .env` instead.

Open `.env` in your editor. Find the existing `BRIGHTDATA_API_TOKEN=` line and paste
your key after the equals sign. Save the file. Edit that line; do not add a second one.

For Reddit, you also need **Web Unlocker** on your Bright Data account. If you don't
have it, open the Bright Data control panel, add a zone, and choose **Web Unlocker**.
A zone is a named configuration for the service. Leave `BRIGHTDATA_ZONE=` empty in
`.env` so the radar can find it automatically. X and GitHub don't need this zone.

**Next: [step 5](#5-smoke-test) to run the radar**, or add the optional agent tools below.

## 3. Connect the Bright Data MCP server (for exploring)

**Optional.** This lets your coding agent use Bright Data while you ask it to explore
websites or find data. The radar runs without this connection.

<details>
<summary>Connect Claude Code or Cursor</summary>

For **Claude Code**, replace `YOUR_API_KEY` below with your key and run this privately
in your terminal. Keep the quotes:

```sh
claude mcp add --transport http --scope local brightdata https://mcp.brightdata.com/mcp --header "Authorization: Bearer YOUR_API_KEY"
```

This stores the connection for this project on your machine. The key is still a
secret; do not share the command with your key filled in, your terminal history,
or the resulting configuration.

For **Cursor**, add a remote HTTP MCP server named `brightdata`:

- URL: `https://mcp.brightdata.com/mcp`
- Header name: `Authorization`
- Header value: `Bearer YOUR_API_KEY`, with your key in place of `YOUR_API_KEY`.

The Cursor setup has not been tested in this workshop. If your settings only accept
a URL, the fallback is `https://mcp.brightdata.com/mcp?token=YOUR_API_KEY`. This puts
the key in the URL, so keep the saved configuration private. `.cursor/` and
`.mcp.json` are ignored by Git in this repo.

To check the connection, ask your agent:

```text
Use the Bright Data search_scrapers tool to find the scraper for LinkedIn company pages and tell me its dataset id.
```

The expected scraper is "LinkedIn company information", `gd_l1vikfnt1wgvvqz95w`.
Check that the agent actually used the tool. An answer from memory does not test
the connection.

Use the server URL above without extra settings such as `groups` or `PRO_MODE`.
Skip the older Bright Data Cursor plugin; its instructions name removed tools.

</details>

## 4. Bright Data agent skills

**Optional.** Skills give your coding agent instructions for using Bright Data.
The radar and project cards work without installing them.

<details>
<summary>Install the skills</summary>

From the project folder:

```sh
npx skills add brightdata/skills
```

Choose your coding agent in the installer. If it asks for a newer Node version,
update Node and try again. The apps themselves work on Node 20, but this installer
needs Node 22 or newer.

If Windows PowerShell says **running scripts is disabled**, use:

```sh
npx.cmd skills add brightdata/skills
```

See [brightdata/skills](https://github.com/brightdata/skills) for the available skills.
The repo's `AGENTS.md` tells your agent which older instructions to skip.

</details>

<a id="5-smoke-test"></a>

## 5. Check that it works

Fetch your first results:

```sh
node radar/radar.mjs
```

You'll see a status line for each source, followed by Reddit posts, X posts and
GitHub projects. Allow about a minute; the X results took 55 to 75 seconds in our
October 22 test. The command saves the results for the page to use.

Now start the page:

```sh
node radar/server.mjs
```

Open http://localhost:3001. Your saved results should already be there.
The terminal stays busy while the page is running. Press **Ctrl+C** to stop it.
Click **Run** on the page whenever you want fresh data.

If something fails, use [Troubleshooting](#troubleshooting) below. In the workshop,
pair with someone whose radar is working and finish your setup later.

<a id="6-in-the-workshop-your-own-subreddit-about-a-minute"></a>

## 6. In the workshop: your own subreddit

While the agent on stage builds the daily summary, choose a subreddit you follow.

1. Stop your page's server with **Ctrl+C** in its terminal.
2. Open `radar/radar.config.json`. Add a subreddit to the `subreddits` list, keeping
   the existing entry. For example, change that line to:

   ```json
   "subreddits": ["LocalLLaMA", "robotics"],
   ```

   Save the file. Use the community name, such as `robotics` or `r/robotics`, rather
   than its full web address. Keep the quotes and commas.
3. Fetch Reddit again:

   ```sh
   node radar/radar.mjs --only reddit
   ```

4. Start the page again, then reload http://localhost:3001:

   ```sh
   node radar/server.mjs
   ```

Look for an actual post labeled with your chosen subreddit. A quiet community may
have few posts today. If it is missing, check the terminal for an error or try a
busier community. Your saved X and GitHub results stay on the page.

No key yet? Follow along with a neighbor and try this after setup.

**Next:** [add a daily summary](radar/README.md#paste-this-into-your-agent-scale-it)
or [pick a project idea](README.md#the-10-ideas).

## Troubleshooting

<details>
<summary>The radar says the API key is missing, or Bright Data returns HTTP 401</summary>

Check the existing `BRIGHTDATA_API_TOKEN=` line in `.env`. It needs your key after
the equals sign. There should be only one line with that name; the scripts use the
first one. HTTP 401 can also mean the key has expired.

Copy `.env.example` and edit it as described in step 2. In Windows PowerShell 5.1,
creating the file with `echo >` or `>>` writes an encoding these scripts cannot read.

Stop and restart `node radar/server.mjs` after changing `.env`. If you already set
`BRIGHTDATA_API_TOKEN` in your terminal or system environment, that value takes
precedence over the file. The code also accepts `BRIGHTDATA_API_KEY` as a fallback.
Keep `.env` out of Git; this repo already ignores it.

For a daily monitor, choose a key expiration date you can maintain, or Unlimited
if appropriate for your account. An expired key will stop future data collection.

</details>

<details>
<summary>Reddit says "No Web Unlocker zone" or "ip_forbidden"</summary>

**No Web Unlocker zone:** add Web Unlocker in the Bright Data control panel, as in
step 2. Put its name on the existing `BRIGHTDATA_ZONE=` line if you want to choose
it explicitly. Otherwise the radar picks the first Web Unlocker zone it finds.
Connecting MCP may create a zone, but that has not been tested on a new account;
use the control panel for this setup.

**ip_forbidden:** the selected zone only allows certain IP addresses. Allow your
current IP in that zone's settings or select a zone your current network can use.
The error can appear inside `HTTP 200 ip_forbidden`; 200 alone does not mean the
page was collected.

Restart the page's server after changing `.env`. X and GitHub can still work while
you fix Reddit. Other error codes in a "no posts after 3 tries" message describe
why that request failed.

</details>

<details>
<summary>GitHub says "search limit reached for this IP"</summary>

Other people on the same Wi-Fi may be using the same GitHub search allowance.
Your Reddit and X results can still work. Try GitHub later, or add a GitHub token:

1. On GitHub, open **Settings > Developer settings > Personal access tokens**.
2. Create a token for reading public repositories; no extra permissions are needed.
3. Paste it on the existing `GITHUB_TOKEN=` line in `.env`.
4. Restart the page's server.

Do not add a duplicate `GITHUB_TOKEN=` line. Treat this token like your Bright Data key.

</details>

<details>
<summary>The page is empty, or my changes are not showing</summary>

- Run step 5 first. A new clone has no saved results to show.
- If you edited `radar/radar.config.json`, check the quotes and commas. Invalid JSON
  produces an error in the terminal.
- After a command-line fetch, stop and restart the page's server, then reload the
  page. An earlier browser run can otherwise keep showing its old results.
- After editing `.env`, stop the server with Ctrl+C and start it again.
- If a source fails, the page can show its last successful results only if you
  have already saved some. Check the displayed time.

</details>
