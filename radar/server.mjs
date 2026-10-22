// AI radar page: Reddit, X and GitHub side by side. Node 20 or newer, no npm install.
// Run: node radar/server.mjs, then open http://localhost:3001
//
// Opening the page fetches nothing. The Run button starts one job; the page polls /api/state and
// fills each column as its source finishes. Every run is saved to radar/data/runs/ (gitignored).
// If a source fails, the page shows that source's last good result, labeled with its time.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, runRadar, lastGood, SOURCES } from './radar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, 'public', 'index.html');
const PORT = Number(process.env.PORT || 3001);

// One job at a time. Clicking Run again while it runs does not start a second one.
let job = null;

function startJob() {
  if (job && job.status === 'running') return job;
  const config = loadConfig();
  job = { status: 'running', started_at: new Date().toISOString(), config, sources: {} };
  for (const k of SOURCES) job.sources[k] = { status: 'running' };
  const current = job;
  runRadar(config, { onSource: (k, r) => { current.sources[k] = r; } })
    .then((run) => { current.status = 'done'; current.fetched_at = run.fetched_at; })
    .catch((err) => {
      // Saving the run failed after the fetches: mark anything unfinished so the page stops waiting.
      current.status = 'error';
      current.error = String(err.message || err);
      for (const k of SOURCES) if (current.sources[k].status === 'running') current.sources[k] = { status: 'error', error: current.error };
    });
  return job;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, await readFile(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, { config: loadConfig(), job, last_good: lastGood() });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      return send(res, 202, startJob());
    }
    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: String(err.message || err) });
  }
});

// Listen on this machine only: the Run button spends calls on your Bright Data key.
server.listen(PORT, '127.0.0.1', () => console.log(`AI radar running at http://localhost:${PORT}`));
