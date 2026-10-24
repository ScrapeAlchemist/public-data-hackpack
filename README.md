# Public Data Hackpack

Build an app that uses real public web data. Start with the AI radar from our
Cal Hacks 13 workshop, or choose one of the ten project ideas below.

Each idea includes a prompt you can paste into Claude Code or Cursor, real sample
data, and the technical instructions your coding agent needs to build it.

## Start with the AI radar

The radar puts Reddit posts, X posts and new GitHub projects on one page. Change
which communities and accounts it watches to make it useful for your own interests.

1. Follow the [setup guide](SETUP.md) to add your Bright Data key and run the radar.
2. Open the page and choose what to watch.
3. Use the [radar guide](radar/README.md) to add a daily summary of what changed.

Already set up? From the `public-data-hackpack` folder, run:

```sh
node radar/server.mjs
```

Open http://localhost:3001. You'll see your last saved results. Click **Run** for
fresh data.

## The 10 ideas

Choose something you'd want to use. Each link opens a project card with a build prompt.

| Idea | What you'll build | Public data from |
|---|---|---|
| [01. Contact autofill](ideas/01-crm-autofill/) | Add a name and company to a CRM, then fill in their profile and company details. | LinkedIn |
| [02. Sales research](ideas/02-sales-agent/) | Find companies that match your customer profile and draft outreach emails. | LinkedIn |
| [03. Resume checker](ideas/03-recruiter/) | Compare a resume with a public profile and flag differences for a recruiter to review. | LinkedIn |
| [04. Hiring tracker](ideas/04-hiring-signals/) | Track which teams a company is hiring for and how that changes over time. | Company careers pages and LinkedIn |
| [05. Price watch](ideas/05-price-watch/) | Compare your products with other stores and spot price changes. | Amazon, Walmart and Target |
| [06. Creator partnerships](ideas/06-influencer-crm/) | Keep follower counts and recent post activity beside your creator partnerships. | Instagram, YouTube and X |
| [07. Product mentions](ideas/07-brand-monitor/) | Bring public discussions and reviews into your product feedback board. | Reddit, YouTube, Trustpilot and G2 |
| [08. Restaurant dashboard](ideas/08-restaurant-dashboard/) | Follow nearby restaurants' ratings, review counts and changes. | Yelp |
| [09. Business loan research](ideas/09-small-business-lender/) | Gather public business information for an underwriter to review. | Yelp, careers pages and LinkedIn |
| [10. Salary comparisons](ideas/10-pay-ranges/) | Compare your salary bands with ranges in public job postings. | LinkedIn, Indeed and company careers pages |

## Build an idea

1. Finish [setup](SETUP.md), then open this folder in Claude Code or Cursor.
2. Pick a card and copy its **Paste this into your agent** block into your coding agent.
3. Let the agent build and test the app. Follow its instructions to open it.
4. Try the app, then ask for a change that makes it useful to you.

The cards are build instructions, not ten finished apps. Card 01 extends the starter
in `crm/`; the other prompts create an app in `apps/`. Tests fetch real public data
and use your Bright Data account. The prompts start with small test inputs.

You can read the idea and use the prompt without working through the API details.
Those are in an expandable section on each card for you and your coding agent.

## Bright Data prize track

Building for Cal Hacks 13? The track is **Best Agent/App Using Public Web Data**.
See [Hive](https://hive.hackberkeley.org), **Prizes** tab, for the rules and judging.
Choose an app where public data helps the user, and show it working in your demo.

## More to explore

- [AI radar guide](radar/README.md): choose sources and build a daily monitor.
- [What we tested](TEST_RESULTS.md): results from the card comparisons, with dates and limits.
- [Agent instructions](AGENTS.md): API requests and implementation details for your coding agent.
- [Bright Data skills](https://github.com/brightdata/skills): optional instructions for your agent.
- [Intern Intel](examples/intern-intel/): an older, finished example that collects internship listings.

<details>
<summary>Try the starter CRM</summary>

From this folder, run `node crm/server.mjs` and open http://localhost:3000.
Card 01 adds public LinkedIn data to this app.

The server keeps your changes in `crm/data/contacts.json`, which Git ignores.
To reset it, stop the server, delete that file, and start the server again.
Leave `crm/data/seed.json` unchanged.

</details>

## Public data only

Use data a logged-out visitor can see. No logins, session cookies or paywalls.
