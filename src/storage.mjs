import { readFileSync } from 'node:fs';
import { writeFile, rename, rm } from 'node:fs/promises';

export class StorageError extends Error {
  constructor() { super('storage failure'); this.name = 'StorageError'; }
}

const CODE = /^[a-z0-9]{6}$/;

function validUrl(u) {
  if (typeof u !== 'string' || u.length > 2048) return false;
  try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; }
}

// Returns a Map, or null when the file is not usable (FR-002).
function load(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    return e.code === 'ENOENT' ? new Map() : null;
  }
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const map = new Map();
  for (const [code, e] of Object.entries(data)) {
    if (!CODE.test(code) || e === null || typeof e !== 'object' || Array.isArray(e)) return null;
    if (Object.keys(e).length !== 2 || !validUrl(e.url) || !Number.isInteger(e.follows) || e.follows < 0) return null;
    map.set(code, { url: e.url, follows: e.follows });
  }
  return map;
}

export function openStore(path = process.env.SHORTLINK_DB || './shortlinks.json') {
  const map = load(path);
  if (map === null) {
    process.stderr.write('SHORTLINK_DB is not valid JSON\n');
    process.exit(1);
  }
  let queue = Promise.resolve();
  let n = 0;
  // Each op derives its next state from committed memory inside its own queue turn;
  // memory changes only after the rename succeeds.
  function change(mutate) {
    const run = queue.then(async () => {
      const next = new Map(map);
      const result = mutate(next);
      const tmp = `${path}.${process.pid}.${n++}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(Object.fromEntries(next)));
        await rename(tmp, path);
      } catch {
        await rm(tmp, { force: true }).catch(() => {});
        throw new StorageError();
      }
      map.clear();
      for (const [k, v] of next) map.set(k, v);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }
  return {
    get: (code) => { const e = map.get(code); return e && { ...e }; },
    has: (code) => map.has(code),
    set: (code, url) => change((m) => { m.set(code, { url, follows: 0 }); }),
    follow: (code) => change((m) => {
      const e = m.get(code);
      if (!e) throw new Error('unknown code');
      m.set(code, { url: e.url, follows: e.follows + 1 });
      return e.follows + 1;
    }),
  };
}
