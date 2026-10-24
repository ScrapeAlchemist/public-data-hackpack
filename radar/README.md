# AI radar

See Reddit posts, X posts and new GitHub projects on one page. Use it to follow AI
news, or change the communities and accounts to watch a topic you care about.

The starter saves every run. The build prompt below adds a daily summary of what's
new and which Reddit posts are gaining votes.

## Run it

Finish [setup](../SETUP.md) first. From the `public-data-hackpack` folder:

```sh
node radar/server.mjs
```

Open http://localhost:3001. You'll see the results you saved during setup.
Click **Run** to collect fresh data. Columns fill as each source finishes.
The filter box searches the results already on the page.

If a source fails, the page shows its last successful results if you have some.
Check the time on the column to see how old they are.

<details>
<summary>Use the terminal instead of the page</summary>

- `node radar/radar.mjs`: fetch all three sources and save the results.
- `node radar/radar.mjs --only reddit`: fetch only Reddit.
- `node radar/radar.mjs --last`: read the last saved run without fetching again.

After fetching from a separate terminal, stop and restart the page's server,
then reload the page to see the new results.

</details>

## Choose what to watch

Open [radar.config.json](radar.config.json) in your editor. Change the settings you
want, save the file, then run the radar again.

| Setting | What to put there |
|---|---|
| `subreddits` | Community names, such as `LocalLLaMA` or `r/LocalLLaMA`. Use names, not full URLs. |
| `x_accounts` | Account handles, such as `OpenAI` or `@OpenAI`. |
| `github_query` | The words or topics you want to find on GitHub. |
| `x_days` | How many days of X posts to look through. |
| `github_days` | How recently GitHub projects must have been created. |

For the workshop exercise, follow [SETUP.md step 6](../SETUP.md#6-in-the-workshop-your-own-subreddit-about-a-minute).
It walks you through adding a subreddit and checking its results.

Reddit uses today's top posts. The two `days` settings only affect X and GitHub.
Keep the file's quotes and commas; a typo can stop the radar from reading it.
If you change your key or zone in `.env`, restart the server.

## Paste this into your agent (scale it)

Use this prompt to add **new** and **rising** labels and a script that prints a daily
summary. Open this project in Claude Code or Cursor and paste the whole block.
The agent will build the feature and test it with a real run on your account.

```
Read AGENTS.md and radar/README.md first.

Scale the AI radar in radar/ (Node 20+, no npm install, keep it that way):
1. Watch more: add r/OpenAI, r/ClaudeAI and r/singularity to radar/radar.config.json.
2. Mark what is new. Compare each run with the previous saved run in radar/data/runs/:
   tag a Reddit post, X post or GitHub repo "new" if its id (for a repo, its name) was not
   in the previous run, and tag a Reddit post "rising" if its score went up by 100 or more.
   With no previous run, tag nothing. Show the tags on the page.
3. Add radar/daily.mjs: run the radar once and print only the tagged items, for a daily cron.
Test with one real run of radar/daily.mjs. Never print the key.
```

## Take it home: a daily monitor

Run the build prompt above first. It creates `radar/daily.mjs`; that file and the
new/rising labels are not part of the starter you cloned.

Once your agent has built and tested it, schedule the script to run each morning.
It can run with your coding agent and browser closed. Your computer must be on
and connected to the internet at the scheduled time.

<details>
<summary>Schedule it on macOS or Linux</summary>

Run `crontab -e`. Add this line for 8:00 each morning, replacing the project path:

```cron
0 8 * * * cd /path/to/public-data-hackpack && node radar/daily.mjs >> radar/data/daily.log 2>&1
```

If the scheduler cannot find `node`, run `which node` and use that full path in the
line above. Quote the project path if it contains spaces.

</details>

<details>
<summary>Schedule it on Windows</summary>

Open **Task Scheduler > Create Basic Task** and choose **Daily**.
For **Start a program**, use:

- **Program:** the full path to `node.exe` (run `where.exe node` to find it).
- **Arguments:** `radar\daily.mjs`
- **Start in:** the full path to your `public-data-hackpack` folder.

Review the task settings before saving. If the wizard does not show **Start in**,
open the saved task's **Properties > Actions**, edit the action, and add it there.

</details>

To view the latest results, start `node radar/server.mjs` and open the page.
It reads your saved data without fetching again.

If there is no earlier run to compare with, nothing is labeled new or rising yet.
Daily runs will mostly find new items. Rising posts need to appear in both runs,
which is more likely when you run twice on the same day.

Reddit and X collection use your Bright Data account. GitHub is collected directly
from GitHub's API. For a daily schedule, set `x_days` to `1` or `2` to focus on recent
posts, and check your Bright Data dashboard and the job's output occasionally.

<details>
<summary>Checks to ask your coding agent for before scheduling</summary>

Ask it to confirm that the monitor:

- Compares each source with the most recent successful run of that source.
- Treats a newly added community or account as a first run, rather than tagging
  everything it finds as new.
- Reports failures clearly, including an expired key or a missing zone.

The October 22 test build handled the first two checks, but reported success to the
scheduler if any source worked. GitHub could succeed while Reddit and X failed.
Ask your agent to make a scheduled run fail when any source fails, or check the
output regularly so those errors do not go unnoticed.

</details>

## Make it yours

- **Watch your field:** change the communities, accounts and GitHub search.
- **Compare sources:** look for a launch name in X posts, Reddit titles and GitHub projects.
- **Show changes over time:** chart a project's stars or a post's score across saved runs.
- **Add another source:** ask your agent to extend the radar using the [build reference](REFERENCE.md#make-it-yours).

## For coding agents and curious builders

Read [REFERENCE.md](REFERENCE.md) for the API requests, field names, complete config
options, sample records, test results and known issues. Reuse the functions in
`radar.mjs` when extending the app; [AGENTS.md](../AGENTS.md) explains how.
