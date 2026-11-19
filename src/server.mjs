import http from 'node:http';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore, validUrl } from './storage.mjs';

const LIMIT = 8192;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TRIES = 5;

function newCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += ALPHABET[randomInt(ALPHABET.length)];
  return c;
}

function send(res, status, body, headers = {}) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

// Resolves a Buffer, or null as soon as the body exceeds the limit.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      if (size > LIMIT) return;
      size += c.length;
      if (size > LIMIT) { chunks.length = 0; resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createApp(store) {
  const inflight = new Set(); // codes drawn but not yet settled in store.set (FR-005)

  async function handle(req, res) {
    if (req.url.split('?')[0] !== '/links') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { allow: 'POST' });

    const tooLarge = () => {
      if (res.headersSent) return;
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'payload too large' }), () => req.destroy());
    };
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > LIMIT) return tooLarge();
    const body = await readBody(req);
    if (body === null) return tooLarge();

    let data;
    try { data = JSON.parse(body.toString('utf8')); } catch { return send(res, 400, { error: 'invalid json' }); }
    const url = data !== null && typeof data === 'object' && !Array.isArray(data) ? data.url : undefined;
    if (!validUrl(url)) return send(res, 400, { error: 'invalid url' });

    let code;
    for (let i = 0; i < TRIES; i++) {
      const c = newCode();
      if (!store.has(c) && !inflight.has(c)) { code = c; break; }
    }
    if (code === undefined) return send(res, 503, { error: 'try again' });
    inflight.add(code);
    try { await store.set(code, url); } finally { inflight.delete(code); }
    send(res, 201, { code, url });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { error: 'storage failure' }));
  });
}

export function startServer(store, port = Number(process.env.PORT) || 3000) {
  const server = createApp(store);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await startServer(openStore());
}
