import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, startServer } from '../src/server.mjs';
import { openStore, StorageError } from '../src/storage.mjs';

async function withApp(fn, store) {
  const dir = mkdtempSync(join(tmpdir(), 'create-'));
  store ??= openStore(join(dir, 'db.json'));
  const server = createApp(store);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, store); } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}
const post = (base, body, path = '/links', headers = {}) => fetch(base + path, { method: 'POST', body, headers });
const j = (url) => JSON.stringify({ url });
const OK = 'http://a.test';

test('FR-003 valid url gives 201 with code and the url unchanged', () => withApp(async (base, store) => {
  const url = 'HTTPS://Example.com/a b?x=1';
  const r = await post(base, j(url));
  assert.equal(r.status, 201);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  const b = await r.json();
  assert.match(b.code, /^[a-z0-9]{6}$/);
  assert.equal(b.url, url);
  assert.equal(store.get(b.code).url, url);
}));

test('FR-003 content-type is not checked; same url twice gives two codes', () => withApp(async (base) => {
  const a = await (await post(base, j(OK), '/links', { 'content-type': 'text/plain' })).json();
  const b = await (await post(base, j(OK))).json();
  assert.notEqual(a.code, b.code);
}));

test('FR-003 invalid json and non-object bodies', () => withApp(async (base) => {
  let r = await post(base, '{nope');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'invalid json' });
  for (const b of ['{}', '{"url":null}', '{"url":5}', '[]', '5', 'null', '[{"url":"http://a.test"}]']) {
    r = await post(base, b);
    assert.equal(r.status, 400, b);
    assert.deepEqual(await r.json(), { error: 'invalid url' }, b);
  }
}));

test('FR-004 url validation', () => withApp(async (base) => {
  const bad = ['', 'example.com', 'ftp://a.test/', 'javascript:alert(1)', '/relative', 'http://', 'http://a.test/' + 'x'.repeat(2048)];
  for (const url of bad) {
    const r = await post(base, j(url));
    assert.equal(r.status, 400, url.slice(0, 30));
    assert.deepEqual(await r.json(), { error: 'invalid url' });
  }
  const edge = 'http://a.test/' + 'x'.repeat(2048 - 14);
  assert.equal(edge.length, 2048);
  assert.equal((await post(base, j(edge))).status, 201);
  assert.equal((await post(base, j('hTtP://a.test'))).status, 201);
}));

test('FR-003 other methods give 405 with Allow; query string ignored', () => withApp(async (base) => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const r = await fetch(base + '/links', { method });
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'POST');
    assert.deepEqual(await r.json(), { error: 'method not allowed' });
  }
  assert.equal((await post(base, j(OK), '/links?x=1')).status, 201);
}));

test('FR-003 other paths give 404, before the method check', () => withApp(async (base) => {
  for (const [m, p] of [['POST', '/'], ['GET', '/links/'], ['GET', '/abcdef'], ['POST', '/Links']]) {
    const r = await fetch(base + p, { method: m, body: m === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 404, m + p);
    assert.deepEqual(await r.json(), { error: 'not found' });
  }
}));

function bodyOfSize(n) {
  const head = '{"url":"http://a.test/","p":"';
  return head + 'x'.repeat(n - head.length - 2) + '"}';
}

test('NFR-001 FR-006 8192 bytes pass, 8193 give 413', () => withApp(async (base) => {
  assert.equal(Buffer.byteLength(bodyOfSize(8192)), 8192);
  assert.equal((await post(base, bodyOfSize(8192))).status, 201);
  const r = await post(base, bodyOfSize(8193));
  assert.equal(r.status, 413);
  assert.deepEqual(await r.json(), { error: 'payload too large' });
}));

test('FR-006 streamed body over the limit (no content-length) gives 413 before JSON parsing', () => withApp(async (base) => {
  const { port } = new URL(base);
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ port, method: 'POST', path: '/links' }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => resolve({ status: r.statusCode, d }));
    });
    req.on('error', reject);
    req.write('x'.repeat(5000)); // chunked, not JSON: 413 must win over invalid json
    req.write('x'.repeat(5000));
    req.end();
  });
  assert.equal(res.status, 413);
  assert.deepEqual(JSON.parse(res.d), { error: 'payload too large' });
}));

test('FR-006 declared content-length over the limit is answered without reading the body', () => withApp(async (base) => {
  const { port } = new URL(base);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ port, method: 'POST', path: '/links', headers: { 'content-length': '100000' } }, (r) => { resolve(r.statusCode); r.resume(); });
    req.on('error', reject);
    req.write('{'); // the body is never completed
  });
  assert.equal(status, 413);
}));

test('FR-005 503 after 5 collisions, each try draws again', () => {
  let calls = 0;
  const store = { has: () => { calls++; return true; }, set: async () => { throw new Error('unreachable'); } };
  return withApp(async (base) => {
    const r = await post(base, j(OK));
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'try again' });
    assert.equal(calls, 5);
  }, store);
});

test('FR-005 a collision is retried, then succeeds', () => {
  let n = 0;
  const store = { has: () => n++ < 4, set: async () => {} };
  return withApp(async (base) => { assert.equal((await post(base, j(OK))).status, 201); }, store);
});

test('FR-005 an in-flight code counts as taken: a fixed first draw collides with it', async (t) => {
  // Every draw is 'aaaaaa', so only the in-flight Set can force a new draw.
  t.mock.method(crypto, 'randomInt', () => 0);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const seen = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const store = { has: () => false, set: async (c) => { seen.push(c); if (seen.length === 1) await gate; } };
  await withApp(async (base) => {
    const p1 = post(base, j(OK));
    while (seen.length < 1) await new Promise((r) => setTimeout(r, 5));
    const r2 = await post(base, j(OK)); // draws the in-flight code 5 times (has() is false), so 503
    release();
    assert.equal(r2.status, 503);
    assert.equal((await p1).status, 201);
  }, store);
});

test('FR-005 concurrent requests get distinct codes and all are stored', () => {
  const map = new Map();
  const store = { has: (c) => map.has(c), set: (c, u) => new Promise((r) => setTimeout(() => { map.set(c, u); r(); }, 20)) };
  return withApp(async (base) => {
    const rs = await Promise.all(Array.from({ length: 30 }, () => post(base, j(OK))));
    const codes = new Set();
    for (const r of rs) { assert.equal(r.status, 201); codes.add((await r.json()).code); }
    assert.equal(codes.size, 30);
    assert.equal(map.size, 30);
  }, store);
});

test('FR-003 StorageError and any other throw give 500; the in-flight code is released', async () => {
  for (const err of [new StorageError(), new Error('boom')]) {
    const seen = [];
    let fail = true;
    await withApp(async (base) => {
      const r = await post(base, j(OK));
      assert.equal(r.status, 500);
      assert.deepEqual(await r.json(), { error: 'storage failure' });
      fail = false;
      assert.equal((await post(base, j(OK))).status, 201);
    }, { has: () => false, set: async (c) => { seen.push(c); if (fail) throw err; } });
  }
});

test('NFR-002 startServer listens on the given port, on PORT, and defaults to 3000', async () => {
  const store = { has: () => false, set: async () => {} };
  const old = process.env.PORT;
  const close = (s) => new Promise((r) => s.close(r));
  try {
    process.env.PORT = '38417';
    const a = await startServer(store);
    assert.equal(a.address().port, 38417);
    await close(a);
    const b = await startServer(store, 0);
    assert.ok(b.address().port > 0);
    await close(b);
    delete process.env.PORT;
    try {
      const c = await startServer(store);
      assert.equal(c.address().port, 3000);
      await close(c);
    } catch (e) {
      assert.equal(e.code, 'EADDRINUSE'); // port 3000 busy here: the default was still tried
    }
  } finally {
    if (old === undefined) delete process.env.PORT; else process.env.PORT = old;
  }
});
