import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openStore, StorageError } from '../src/storage.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'sl-'));
const SRC = new URL('../src/storage.mjs', import.meta.url).href;
const CODE = `import("${SRC}").then(m=>{m.openStore();console.log("ok")})`;
const boot = (path, opts = {}) => spawnSync(process.execPath, ['-e', CODE],
  { env: { ...process.env, SHORTLINK_DB: path }, encoding: 'utf8', ...opts }); // env-ignore

// FR-001, FR-002
test('missing file: empty store, file not created at start', () => {
  const p = join(dir(), 'db.json');
  const s = openStore(p);
  assert.equal(s.has('abc123'), false);
  assert.equal(existsSync(p), false);
});

test('links and follows persist across reopen', async () => {
  const p = join(dir(), 'db.json');
  const s = openStore(p);
  await s.set('abc123', 'https://example.com');
  assert.equal(await s.follow('abc123'), 1);
  assert.equal(await s.follow('abc123'), 2);
  const s2 = openStore(p);
  assert.deepEqual(s2.get('abc123'), { url: 'https://example.com', follows: 2 });
});

test('set on existing code overwrites and resets follows', async () => {
  const s = openStore(join(dir(), 'db.json'));
  await s.set('abc123', 'https://a.com');
  await s.follow('abc123');
  await s.set('abc123', 'https://b.com');
  assert.deepEqual(s.get('abc123'), { url: 'https://b.com', follows: 0 });
});

test('follow on unknown code rejects', async () => {
  const s = openStore(join(dir(), 'db.json'));
  await assert.rejects(s.follow('zzzzzz'), { message: 'unknown code' });
});

test('empty SHORTLINK_DB uses ./shortlinks.json', () => {
  const d = dir();
  const code = `import("${SRC}").then(m=>m.openStore().set("abc123","https://a.com"))`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: d, env: { ...process.env, SHORTLINK_DB: '' }, encoding: 'utf8' }); // env-ignore
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(readFileSync(join(d, 'shortlinks.json'), 'utf8')).abc123);
});

const good = { url: 'https://example.com', follows: 0 };
const cases = {
  empty: '',
  'invalid json': '{nope',
  array: '[]',
  null: 'null',
  'bad code': JSON.stringify({ ABC: good }),
  'non-string url': JSON.stringify({ abc123: { url: 5, follows: 0 } }),
  'non-http url': JSON.stringify({ abc123: { url: 'javascript:alert(1)', follows: 0 } }),
  'long url': JSON.stringify({ abc123: { url: 'https://a.com/' + 'x'.repeat(2048), follows: 0 } }),
  'unparseable url': JSON.stringify({ abc123: { url: 'http://exa mple.com', follows: 0 } }),
  'extra key': JSON.stringify({ abc123: { url: good.url, follows: 0, x: 1 } }),
  'negative follows': JSON.stringify({ abc123: { url: good.url, follows: -1 } }),
  'fractional follows': JSON.stringify({ abc123: { url: good.url, follows: 1.5 } }),
  'null entry': JSON.stringify({ abc123: null }),
  'proto key': '{"__proto__":{"url":"http://x.io","follows":0}}',
};
for (const [name, content] of Object.entries(cases)) {
  test(`corrupt (${name}) refuses start`, () => {
    const p = join(dir(), 'db.json');
    writeFileSync(p, content);
    const r = boot(p);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SHORTLINK_DB is not valid JSON/);
  });
}

test('url length boundary: 2048 accepted, 2049 refused; scheme case-insensitive', () => {
  const mk = (n) => JSON.stringify({ abc123: { url: 'HTTPS://a.com/' + 'x'.repeat(n - 14), follows: 0 } });
  const p = join(dir(), 'db.json');
  writeFileSync(p, mk(2048));
  assert.equal(boot(p).status, 0);
  writeFileSync(p, mk(2049));
  assert.equal(boot(p).status, 1);
});

test('unreadable path (directory) refuses start', () => {
  const p = join(dir(), 'sub');
  mkdirSync(p);
  const r = boot(p);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SHORTLINK_DB is not valid JSON/);
});

test('failed write: StorageError, memory unchanged; later write succeeds and file equals memory', async () => {
  const d = dir();
  const p = join(d, 'sub', 'db.json');
  const s = openStore(p);
  await assert.rejects(s.set('abc123', 'https://a.com'), StorageError);
  assert.equal(s.has('abc123'), false);
  mkdirSync(join(d, 'sub'));
  await s.set('def456', 'https://b.com');
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), { def456: { url: 'https://b.com', follows: 0 } });
  assert.equal(s.has('abc123'), false);
});

test('queued writes that fail do not leak into memory', async () => {
  const s = openStore(join(dir(), 'sub', 'db.json'));
  const a = s.set('aaaaaa', 'https://a.com');
  const b = s.set('bbbbbb', 'https://b.com');
  await assert.rejects(a, StorageError);
  await assert.rejects(b, StorageError);
  assert.equal(s.has('aaaaaa') || s.has('bbbbbb'), false);
});

test('concurrent follows are serialized', async () => {
  const p = join(dir(), 'db.json');
  const s = openStore(p);
  await s.set('abc123', 'https://a.com');
  const r = await Promise.all([1, 2, 3, 4, 5].map(() => s.follow('abc123')));
  assert.deepEqual(r, [1, 2, 3, 4, 5]);
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).abc123.follows, 5);
});
