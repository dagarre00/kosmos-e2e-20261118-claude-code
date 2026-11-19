#!/usr/bin/env node
// preview.mjs: show a UI mockup to the human from any harness. Exit 0 PASS, 1 FAIL, 2 BLOCKED.
// Usage: node scripts/preview.mjs <name> [--serve [--port <n>]] | --self-test (see scripts/README.md)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; // also rules out path traversal: no dots, no slashes
const USAGE = 'FAIL [usage] preview.mjs <name> [--serve [--port <n>]]; <name> is the mockup file name without .html';
const mockupPath = (root, name) => join(root, 'wiki', 'contracts', 'ui', 'mockups', `${name}.html`);

function done(code, line) {
  console.log(line);
  process.exit(code);
}

// Serves exactly one file on loopback; every other path is 404, so nothing else on disk is reachable.
function serve(file, port) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || !['/', '/index.html'].includes(req.url)) {
      res.writeHead(404).end();
      return;
    }
    let body;
    try { body = readFileSync(file); } catch { res.writeHead(404).end(); return; } // re-read so edits show on reload
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// Hands the file to the OS default browser; false when no opener exists (headless, container, CI).
function openInBrowser(file) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', file]]
    : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

async function selfTest() {
  const errors = [];
  for (const bad of ['', '../x', 'a/b', 'A', 'a.html', '-a', 'a--b']) if (NAME_RE.test(bad)) errors.push(`name "${bad}" accepted`);
  if (!NAME_RE.test('sign-in-2')) errors.push('name "sign-in-2" rejected');
  const tmp = mkdtempSync(join(tmpdir(), 'preview-test-'));
  const file = join(tmp, 'm.html');
  writeFileSync(file, '<!doctype html><title>m</title>MARK\n');
  let server;
  try {
    server = await serve(file, 0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const ok = await fetch(`${base}/`);
    if (ok.status !== 200 || !(await ok.text()).includes('MARK')) errors.push('GET / did not return the mockup');
    for (const p of ['/m.html', '/%2e%2e/etc/passwd', '/index.html/x']) {
      const r = await fetch(`${base}${p}`);
      if (r.status !== 404) errors.push(`GET ${p} returned ${r.status}, want 404`);
    }
  } catch (e) {
    errors.push(`serve: ${e.message}`);
  } finally {
    server?.closeAllConnections();
    await new Promise((r) => (server ? server.close(r) : r()));
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const e of errors) console.log(`FAIL [self-test] ${e}`);
  console.log(errors.length ? `FAIL ${errors.length}` : 'SELF_TEST_OK');
  process.exitCode = errors.length ? 1 : 0; // no process.exit: let sockets close first (libuv asserts on Windows)
}

async function main(argv) {
  if (argv[0] === '--self-test') return selfTest();
  const [name, ...rest] = argv;
  const serveMode = rest.includes('--serve');
  const pi = rest.indexOf('--port');
  const port = pi < 0 ? 0 : Number(rest[pi + 1]);
  const known = rest.every((a, i) => a === '--serve' || a === '--port' || (pi >= 0 && i === pi + 1));
  if (!name || !NAME_RE.test(name) || !known || (pi >= 0 && !serveMode)) done(1, USAGE);
  if (!Number.isInteger(port) || port < 0 || port > 65535) done(1, 'FAIL [usage] --port takes 0-65535 (0 picks a free port)');
  const file = mockupPath(ROOT, name);
  if (!existsSync(file)) done(1, `FAIL [mockup] ${relative(ROOT, file).replaceAll('\\', '/')} does not exist`);

  if (serveMode) {
    let server;
    try { server = await serve(file, port); } catch (e) { done(2, `BLOCKED [serve] ${e.message}`); }
    // Stays in the foreground until stopped; harnesses run it in the background.
    console.log(`PREVIEW http://127.0.0.1:${server.address().port}/ (loopback only; forward this port from a remote session; Ctrl+C stops)`);
    return;
  }
  const url = pathToFileURL(file).href;
  if (await openInBrowser(file)) done(0, `PREVIEW ${url}`);
  done(2, `BLOCKED [open] no browser opener here; open ${url} by hand, or rerun with --serve`);
}

main(process.argv.slice(2)).catch((e) => done(2, `BLOCKED [preview] ${e.message}`));
