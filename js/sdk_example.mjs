// The same Indeed page as intern_intel.mjs, fetched with the @brightdata/sdk package instead of
// fetch.mjs, then parsed with the same parser. A short example for anyone who wants the SDK.
//
//   node sdk_example.mjs
//   node sdk_example.mjs "data science intern" "New York, NY"
//
// Token: BRIGHTDATA_API_TOKEN, from the environment or the repo-root .env (fetch.mjs loads it).
// Zone: BRIGHTDATA_ZONE, your Web Unlocker zone. If it is empty, we pick a Web Unlocker zone
// from your account the same way intern_intel.mjs does (fetch.mjs zone()). The SDK's own
// variable for the zone is BRIGHTDATA_WEB_UNLOCKER_ZONE, so we pass the zone in explicitly.
// An empty page is asked for once more; if it is still empty, the script exits with code 1.
//
// The pipeline itself uses fetch.mjs (plain fetch) because it reads the x-brd-error-code
// header to tell a login wall from a slow page, and retries at most once. The SDK hides the
// response headers and retries 429 and 5xx answers up to 3 times on its own.
// This example does not use cache/.

import { bdclient } from '@brightdata/sdk';

import { zone } from './fetch.mjs'; // importing fetch.mjs also loads the repo-root .env
import { parseIndeed } from './parsers.mjs';
import { indeedUrl } from './sources.mjs';

const role = process.argv[2] || 'software engineer intern';
const location = process.argv[3] || 'San Francisco, CA';

if (!process.env.BRIGHTDATA_API_TOKEN && !process.env.BRIGHTDATA_API_KEY) {
  console.error('Set BRIGHTDATA_API_TOKEN (see .env.example).');
  process.exit(1);
}

let zoneName;
try {
  zoneName = await zone();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const url = indeedUrl(role, location);
const client = new bdclient({
  apiKey: process.env.BRIGHTDATA_API_TOKEN || process.env.BRIGHTDATA_API_KEY,
  webUnlockerZone: zoneName,
  autoCreateZones: false, // use the zone we found, never create one
});

try {
  let markdown = '';
  let seconds = '0.0';
  for (let attempt = 1; attempt <= 2 && !markdown.trim(); attempt++) {
    if (attempt === 2) console.log('Bright Data returned an empty page, asking once more ...');
    const started = Date.now();
    markdown = (await client.scrapeUrl(url, { dataFormat: 'markdown', country: 'us' })) ?? '';
    seconds = ((Date.now() - started) / 1000).toFixed(1);
  }
  console.log(`${url}`);
  if (!markdown.trim()) {
    console.error('Bright Data returned an empty page, try again.');
    process.exitCode = 1;
  } else {
    const rows = parseIndeed(markdown);
    console.log(`${markdown.length} characters of markdown in ${seconds} s, ${rows.length} rows`);
    for (const row of rows.slice(0, 5)) {
      console.log(`- ${row.title} | ${row.company} | ${row.location || ''} | ${row.pay || ''}`);
    }
  }
} finally {
  await client.close(); // without this, Node warns about open connections at exit
}
