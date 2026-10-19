// Tiny CRM: contacts with a stage, notes and a next step. No public data yet.
// Node 20 or newer, no npm install. Run: node crm/server.mjs, then open http://localhost:3000
// Contacts are kept in crm/data/contacts.json (gitignored, so what you type never lands in a commit).
// The first run copies the three sample contacts from crm/data/seed.json. Delete contacts.json to start over.

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(HERE, 'data', 'contacts.json');
const SEED_FILE = path.join(HERE, 'data', 'seed.json');
const PAGE = path.join(HERE, 'public', 'index.html');
const PORT = Number(process.env.PORT || 3000);
const STAGES = ['lead', 'contacted', 'meeting', 'proposal', 'won', 'lost'];

async function loadContacts() {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  // No contacts.json yet: start from the seed and write it, so later changes go to contacts.json.
  let seed;
  try {
    seed = JSON.parse(await readFile(SEED_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  await saveContacts(seed);
  return seed;
}

async function saveContacts(contacts) {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(contacts, null, 2) + '\n');
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

// Only these fields come from the form. Anything else in the body is ignored.
function pickEditable(body) {
  const out = {};
  for (const key of ['name', 'company', 'linkedin_url', 'stage', 'notes', 'next_step', 'last_contacted']) {
    if (typeof body[key] === 'string') out[key] = body[key].trim();
  }
  if (out.stage && !STAGES.includes(out.stage)) delete out.stage;
  return out;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/contacts(?:\/([\w-]+))?$/);

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, await readFile(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }
    if (!match) return send(res, 404, { error: 'not found' });

    const id = match[1];
    const contacts = await loadContacts();

    if (req.method === 'GET' && !id) return send(res, 200, { stages: STAGES, contacts });

    if (req.method === 'POST' && !id) {
      const fields = pickEditable(await readBody(req));
      if (!fields.name) return send(res, 400, { error: 'name is required' });
      const contact = {
        id: randomUUID(),
        name: fields.name,
        company: fields.company || '',
        linkedin_url: fields.linkedin_url || '',
        stage: fields.stage || 'lead',
        notes: fields.notes || '',
        next_step: fields.next_step || '',
        last_contacted: fields.last_contacted || '',
        created_at: new Date().toISOString(),
      };
      contacts.push(contact);
      await saveContacts(contacts);
      return send(res, 201, contact);
    }

    const index = contacts.findIndex((c) => c.id === id);
    if (id && index === -1) return send(res, 404, { error: 'no such contact' });

    if (req.method === 'PATCH' && id) {
      Object.assign(contacts[index], pickEditable(await readBody(req)));
      await saveContacts(contacts);
      return send(res, 200, contacts[index]);
    }
    if (req.method === 'DELETE' && id) {
      const [removed] = contacts.splice(index, 1);
      await saveContacts(contacts);
      return send(res, 200, removed);
    }
    return send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: String(err.message || err) });
  }
});

// Listen on this machine only. The API has no access control, so on shared Wi-Fi anyone on the
// network could read and edit the contacts.
server.listen(PORT, '127.0.0.1', () => console.log(`CRM running at http://localhost:${PORT}`));
