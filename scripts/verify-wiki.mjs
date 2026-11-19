#!/usr/bin/env node
// verify-wiki.mjs: structural checks for wiki/. Exit 0 PASS, 1 FAIL, 2 BLOCKED.
// Usage: node scripts/verify-wiki.mjs [--check-env] [--check-debt] [--check-coverage] | --self-test
import { spawnSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKS = ['size', 'links', 'layering', 'frontmatter', 'precision', 'trace', 'env', 'debt', 'coverage'];
const LAYERS = { product: 0, domain: 1, features: 2, contracts: 3, infra: 4 };
const STATUSES = ['draft', 'locked', 'legacy', 'retired'];
const BANNED = [/\bTBD\b/, /\bTODO\b(?!\.md)/, /\?\?\?/, /\bWIKI_GAP\b/, /\betc\./i, /\band so on\b/i,
  /\bas appropriate\b/i, /\bsomehow\b/i];
const ENV_IGNORE = new Set(['NODE_ENV', 'CI', 'PATH', 'HOME', 'TZ', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL']);
const STACK = 'wiki/infra/00-stack.md';

// One fixed pattern set per language: `prefix` followed by a quoted name is a read,
// `prefix` followed by anything else is a dynamic read.
const lang = (ext, prefix, read = [], dyn = []) => ({
  ext,
  read: [new RegExp(`(?:${prefix})\\s*['"](\\w+)['"]`, 'g'), ...read],
  dyn: [new RegExp(`(?:${prefix})(?!\\s*['"])`), ...dyn],
});
const ENV_LANGS = [
  lang(/\.(?:[cm]?[jt]sx?|vue|svelte)$/, '(?:process|import\\.meta)\\.env\\[',
    [/process\.env\.([A-Za-z_]\w*)/g, /import\.meta\.env\.([A-Za-z_]\w*)/g],
    [/(?:process|import\.meta)\.env(?![.[\w])/]),
  lang(/\.py$/, 'os\\.environ\\[|os\\.getenv\\(|os\\.environ\\.get\\('),
  lang(/\.go$/, 'os\\.Getenv\\(|os\\.LookupEnv\\('),
  lang(/\.rb$/, '\\bENV\\[|\\bENV\\.fetch\\('),
  lang(/\.rs$/, 'env::var(?:_os)?\\(|\\benv!\\('),
  lang(/\.php$/, 'getenv\\(|\\$_ENV\\['),
  lang(/\.(?:java|kt)$/, 'System\\.getenv\\('),
  lang(/\.cs$/, 'GetEnvironmentVariable\\('),
];

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const trimSlash = (p) => p.replace(/\/+$/, '');
const under = (f, p) => f === p || f.startsWith(`${trimSlash(p)}/`);
const isComponent = (id) => id.startsWith('contracts/components/') && !id.split('/').pop().startsWith('00-');

// A sandbox may deny named pipes, so child stdout/stderr go through files, not `stdio: 'pipe'`.
function capture(command, args, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-wiki-run-'));
  const out = join(dir, 'stdout');
  const err = join(dir, 'stderr');
  const outFd = openSync(out, 'w');
  const errFd = openSync(err, 'w');
  try {
    const r = spawnSync(command, args, { ...options, stdio: ['ignore', outFd, errFd] });
    return { status: r.status, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8') };
  } finally {
    closeSync(outFd);
    closeSync(errFd);
    rmSync(dir, { recursive: true, force: true });
  }
}

function git(root, args) {
  const r = capture('git', args, { cwd: root });
  return r.status === 0 ? r.stdout : null;
}

// Files below dir, recursive, as posix paths relative to dir.
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.git' || e.name === 'node_modules') return [];
    return e.isDirectory() ? walk(join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name];
  });
}

// Tracked and untracked-but-not-ignored files under the source roots; plain walk outside git.
function sourceFiles(root, roots) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...roots]);
  const files = out === null
    ? roots.flatMap((r) => walk(join(root, r)).map((f) => `${r}/${f}`))
    : out.split('\0').filter((f) => f && existsSync(join(root, f)));
  return [...new Set(files)].sort();
}

function parsePage(root, id) {
  const file = `wiki/${id}.md`;
  const lines = read(join(root, file)).split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const fm = {};
  const fmErrors = [];
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end < 0) fmErrors.push([1, 'unterminated frontmatter']);
    for (let i = 1; i < end; i++) {
      const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
      if (!m) {
        if (lines[i].trim()) fmErrors.push([i + 1, 'only flat "key: value" lines and inline lists are allowed']);
        continue;
      }
      const v = m[2].trim();
      fm[m[1]] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : v;
    }
    start = Math.max(end, 0) + 1;
  }
  const all = []; // body lines; `fence` marks code-fence content
  let fence = null;
  for (let i = start; i < lines.length; i++) {
    const m = /^\s*(```|~~~)/.exec(lines[i]);
    if (m && (!fence || fence === m[1])) { fence = fence ? null : m[1]; continue; }
    all.push({ n: i + 1, text: lines[i], fence: !!fence, table: !fence && /^\s*\|/.test(lines[i]) });
  }
  return { id, file, fm, fmErrors, all, body: all.filter((l) => !l.fence), lineCount: lines.length };
}

// Lines of the section opened by the heading at index i of `lines`.
function section(lines, i) {
  const level = /^#+/.exec(lines[i].text)[0].length;
  const rest = lines.slice(i + 1);
  const end = rest.findIndex((l) => !l.fence && new RegExp(`^#{1,${level}}\\s`).test(l.text));
  return end < 0 ? rest : rest.slice(0, end);
}

function hasSpecified(page) {
  const i = page.all.findIndex((l) => !l.fence && /^##\s+Specified\s*$/.test(l.text));
  return i >= 0 && section(page.all, i).some((l) => l.text.trim());
}

// Checks 1-6. Returns the page map.
function checkWiki(root, add) {
  const ids = walk(join(root, 'wiki'))
    .filter((f) => f.endsWith('.md') && f.split('/').pop() !== '_template.md' && !f.split('/').includes('mockups'))
    .map((f) => f.slice(0, -3)).sort();
  const pages = new Map(ids.map((id) => [id, parsePage(root, id)]));
  const layer = (id) => (id.startsWith('decisions/') || !id.includes('/') ? null : LAYERS[id.split('/')[0]]);
  const edges = new Map();
  const declared = new Map(); // ID -> file
  const lockedFrs = [];

  for (const p of pages.values()) {
    const { id, file, fm } = p;
    const st = fm.status;

    // 1. size
    const words = p.body.filter((l) => !l.table).map((l) => l.text).join(' ').split(/\s+/).filter(Boolean).length;
    const cap = id.startsWith('contracts/components/') ? 350 : 500;
    if (words > cap) add('FAIL', 'size', `${file}:1`, `${words} words > ${cap}`);
    if (id === '00-index' && p.lineCount > 50) add('FAIL', 'size', `${file}:1`, `${p.lineCount} lines > 50`);

    // 2. links, 3. layering
    if (layer(id) === undefined) add('FAIL', 'layering', `${file}:1`, 'page is outside the five layer folders and decisions/');
    edges.set(id, []);
    for (const l of p.body) {
      for (const m of l.text.replace(/(`+).*?\1/g, '').matchAll(/\[\[([^\]]+)\]\]/g)) { // inline code (any backtick run) is literal text
        if (!pages.has(m[1])) { add('FAIL', 'links', `${file}:${l.n}`, `[[${m[1]}]] does not resolve`); continue; }
        edges.get(id).push(m[1]);
        if (layer(id) != null && layer(m[1]) != null && layer(m[1]) > layer(id)) {
          add('FAIL', 'layering', `${file}:${l.n}`, `${id.split('/')[0]} may not link outward to [[${m[1]}]]`);
        }
      }
    }

    // 4. frontmatter
    for (const [n, msg] of p.fmErrors) add('FAIL', 'frontmatter', `${file}:${n}`, msg);
    if (!STATUSES.includes(st)) add('FAIL', 'frontmatter', `${file}:1`, `status must be one of ${STATUSES.join(' | ')}`);
    if (isComponent(id) && st !== 'retired') {
      const need = st === 'legacy' ? ['target'] : ['target', 'implements', 'tests', 'implementation'];
      const missing = need.filter((k) => fm[k] === undefined || fm[k] === '');
      if (missing.length) add('FAIL', 'frontmatter', `${file}:1`, `component page is missing ${missing.join(', ')}`);
      else if (typeof fm.target !== 'string') add('FAIL', 'frontmatter', `${file}:1`, 'target must be a single path');
      else if (st !== 'legacy') {
        if (!Array.isArray(fm.implements) || !Array.isArray(fm.tests)) {
          add('FAIL', 'frontmatter', `${file}:1`, 'implements and tests must be inline lists');
        }
        if (!['pending', 'done'].includes(fm.implementation)) {
          add('FAIL', 'frontmatter', `${file}:1`, 'implementation must be pending | done');
        }
      }
    }
    // A UI contract is built from a mockup the human saw; locking it records who approved it and when.
    if (id.startsWith('contracts/ui/') && !id.split('/').pop().startsWith('00-') && st !== 'retired') {
      const mock = typeof fm.mockup === 'string' ? fm.mockup : '';
      if (!/^mockups\/[a-z0-9]+(-[a-z0-9]+)*\.html$/.test(mock) || !existsSync(join(root, 'wiki/contracts/ui', mock))) {
        add('FAIL', 'frontmatter', `${file}:1`, 'UI contract needs mockup: mockups/<name>.html, an existing file');
      } else if (st === 'locked' && !/^[^<>\s][^<>]* \d{4}-\d{2}-\d{2}$/.test(typeof fm['approved-by'] === 'string' ? fm['approved-by'] : '')) {
        add('FAIL', 'frontmatter', `${file}:1`, 'locked UI contract needs approved-by: <human> <yyyy-mm-dd>');
      }
    }

    // 5. precision
    for (const l of p.body) {
      const hit = BANNED.map((re) => re.exec(l.text)).find(Boolean);
      if (st === 'locked' && hit) add('FAIL', 'precision', `${file}:${l.n}`, `"${hit[0]}" on a locked page`);
      else if (st === 'draft' && /\bWIKI_GAP\b/.test(l.text)) add('INFO', '', `DRAFT_GAP ${file}:${l.n}`, '');
    }

    // 6. traceability: declarations
    p.all.forEach((l, i) => {
      const m = l.fence ? null : /^#{1,6}\s+((US|FR|NFR)-(\d+))(?!\d)/.exec(l.text);
      if (!m) return;
      const at = `${file}:${l.n}`;
      if (m[3].length !== 3) add('FAIL', 'trace', at, `${m[1]} needs exactly three digits`);
      if (declared.has(m[1])) add('FAIL', 'trace', at, `${m[1]} is already declared in ${declared.get(m[1])}`);
      else declared.set(m[1], file);
      if (st !== 'locked') return;
      const text = section(p.all, i).map((s) => s.text).join('\n');
      if (m[2] === 'US') {
        const lacks = ['Given', 'When', 'Then'].filter((w) => !new RegExp(`\\b${w}\\b`).test(text));
        if (lacks.length) add('FAIL', 'trace', at, `${m[1]} lacks ${lacks.join(', ')}`);
      } else if (m[2] === 'NFR') {
        if (!/^\s*(?:[-*]\s+)?Verify:/m.test(text)) add('FAIL', 'trace', at, `${m[1]} has no "Verify:" line`);
      } else lockedFrs.push([m[1], at]);
    });
  }

  // 2. a locked page may not rest on a draft one (folder indexes stay draft and are exempt)
  for (const p of pages.values()) {
    if (p.fm.status !== 'locked') continue;
    for (const to of new Set(edges.get(p.id))) {
      if (!to.split('/').pop().startsWith('00-') && pages.get(to).fm.status === 'draft') {
        add('FAIL', 'links', `${p.file}:1`, `locked page links draft [[${to}]]; lock it in the same task`);
      }
    }
  }

  // 2. reachability
  if (!pages.has('00-index')) add('FAIL', 'links', 'wiki/00-index.md:1', 'missing');
  const seen = new Set(pages.has('00-index') ? ['00-index'] : []);
  for (const id of seen) for (const to of edges.get(id)) seen.add(to);
  for (const p of pages.values()) {
    if (pages.has('00-index') && !seen.has(p.id)) add('FAIL', 'links', `${p.file}:1`, 'not reachable from 00-index.md');
  }

  // 6. traceability: implements and tests
  const components = [...pages.values()].filter((p) => isComponent(p.id) && p.fm.status !== 'retired');
  const implemented = new Set(components.flatMap((p) => (Array.isArray(p.fm.implements) ? p.fm.implements : [])));
  for (const [id, at] of lockedFrs) {
    if (!implemented.has(id)) add('FAIL', 'trace', at, `${id} is in no component's implements`);
  }
  for (const p of components) {
    const { fm, file } = p;
    const impl = Array.isArray(fm.implements) ? fm.implements : [];
    for (const id of impl) if (!declared.has(id)) add('FAIL', 'trace', `${file}:1`, `implements ${id}, which no page declares`);
    if (fm.implementation !== 'done' || fm.status === 'legacy') continue;
    const tests = Array.isArray(fm.tests) ? fm.tests : [];
    if (!tests.length) add('FAIL', 'trace', `${file}:1`, 'implementation: done requires at least one tests path');
    for (const t of [fm.target, ...tests]) {
      if (typeof t !== 'string' || !t || !existsSync(join(root, t))) add('FAIL', 'trace', `${file}:1`, `implementation: done but ${t} does not exist`);
    }
    const text = tests.flatMap((t) => (isDir(join(root, t)) ? walk(join(root, t)).map((f) => `${t}/${f}`) : [t]))
      .map((t) => read(join(root, t))).join('\n');
    for (const id of impl) {
      if (!text.includes(id)) add('FAIL', 'trace', `${file}:1`, `${id} is named in no tests file`);
    }
  }
  return pages;
}

// 7. names in .env.example, DEPLOY_INVENTORY.md and source reads must match.
function checkEnv(root, files, add) {
  const names = new Map(); // name -> { ex, inv, read }
  const mark = (n, key, v) => {
    if (!ENV_IGNORE.has(n) && !names.get(n)?.[key]) names.set(n, { ...names.get(n), [key]: v });
  };
  const sources = [
    ['.env.example', 'ex', /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm],
    ['DEPLOY_INVENTORY.md', 'inv', /^\|\s*`([A-Z][A-Z0-9_]*)`/gm],
  ];
  for (const [file, key, re] of sources) {
    if (!existsSync(join(root, file))) { add('BLOCKED', 'env', file, 'file is missing'); continue; }
    for (const m of read(join(root, file)).matchAll(re)) mark(m[1], key, file);
  }
  for (const f of files) {
    const l = ENV_LANGS.find((x) => x.ext.test(f));
    if (!l) continue;
    read(join(root, f)).split(/\r?\n/).forEach((line, i) => {
      for (const re of l.read) for (const m of line.matchAll(re)) mark(m[1], 'read', `${f}:${i + 1}`);
      if (!line.includes('env-ignore') && l.dyn.some((re) => re.test(line))) {
        add('BLOCKED', 'env', 'ENV_UNRESOLVED', `${f}:${i + 1}`);
      }
    });
  }
  for (const [n, s] of [...names].sort(([a], [b]) => a.localeCompare(b))) {
    if (s.ex && s.inv && s.read) continue;
    const yn = (v) => (v ? 'yes' : 'no');
    add('FAIL', 'env', s.read || s.ex || s.inv, `${n} .env.example=${yn(s.ex)} DEPLOY_INVENTORY.md=${yn(s.inv)} read=${yn(s.read)}`);
  }
}

// 8. every ponytail: marker has "<ceiling> | <upgrade path>".
function checkDebt(root, files, add) {
  for (const f of files) {
    read(join(root, f)).split(/\r?\n/).forEach((line, i) => {
      if (line.includes('ponytail:') && !/ponytail:\s*[^|\s][^|]*\|\s*\S/.test(line)) {
        add('FAIL', 'debt', `${f}:${i + 1}`, 'ponytail: needs "<ceiling> | <upgrade path>"');
      }
    });
  }
}

// 9. every source file sits under a component page (target or tests) or a 00-modules.md path.
function checkCoverage(root, files, pages, cfg, add, branchRule) {
  const owners = []; // { path, page } where page is null for a 00-modules.md row
  for (const p of pages.values()) {
    if (!isComponent(p.id) || p.fm.status === 'retired') continue;
    const tests = Array.isArray(p.fm.tests) ? p.fm.tests : [];
    for (const t of [p.fm.target, ...tests]) if (typeof t === 'string' && t) owners.push({ path: t, page: p });
  }
  for (const l of pages.get('contracts/components/00-modules')?.body ?? []) {
    const m = /^\s*\|\s*`?([^`|]+?)`?\s*\|/.exec(l.text);
    if (m && !/^(:?-+:?|path)$/i.test(m[1])) owners.push({ path: m[1], page: null });
  }
  const owner = (f) => owners.filter((o) => under(f, o.path))
    .sort((a, b) => trimSlash(b.path).length - trimSlash(a.path).length || !!b.page - !!a.page)[0];
  const specified = (o) => !!o?.page && o.page.fm.status === 'locked';

  const count = { specified: 0, legacy: 0, uncovered: 0 };
  for (const f of files) {
    const o = owner(f);
    if (!o) add('FAIL', 'coverage', f, 'sits under no component target and no 00-modules.md path');
    count[!o ? 'uncovered' : specified(o) ? 'specified' : 'legacy']++;
  }

  // Branch rule: new code is specified; changed legacy code has a "## Specified" section.
  const base = branchRule && cfg.integration
    && [`origin/${cfg.integration}`, cfg.integration].find((r) => git(root, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]) !== null);
  const mergeBase = base ? git(root, ['merge-base', base, 'HEAD'])?.trim() : null;
  // A shallow CI clone has no base; say so instead of silently skipping the rule.
  if (branchRule && cfg.integration && !mergeBase) {
    add('BLOCKED', 'coverage', cfg.integration, 'no merge-base with the integration branch; fetch full history (fetch-depth 0)');
  }
  if (mergeBase) {
    const diff = git(root, ['diff', '--name-status', '--no-renames', '-z', mergeBase, '--', ...cfg.roots]) ?? '';
    const parts = diff.split('\0').filter(Boolean);
    const changes = [];
    for (let i = 0; i + 1 < parts.length; i += 2) changes.push([parts[i], parts[i + 1]]);
    const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...cfg.roots]) ?? '';
    for (const f of untracked.split('\0').filter(Boolean)) changes.push(['A', f]);
    for (const [kind, f] of changes) {
      const o = owner(f);
      if (!o || kind === 'D') continue; // uncovered files are already reported above
      if (kind === 'A' && !specified(o)) add('FAIL', 'coverage', f, 'added without spec (needs a locked component page)');
      if (kind === 'M' && !specified(o) && !(o.page?.fm.status === 'legacy' && hasSpecified(o.page))) {
        add('FAIL', 'coverage', f, 'changed without spec');
      }
    }
  }

  const pct = (n) => (files.length ? Math.round((100 * n) / files.length) : 0);
  add('INFO', '', `COVERAGE specified=${pct(count.specified)}% legacy=${pct(count.legacy)}% uncovered=${count.uncovered}`, '');
}

function run(root, flags, branchRule) {
  const findings = [];
  const add = (level, check, loc, msg) => findings.push({
    level, check, text: level === 'INFO' ? loc : `${level} [${check}] ${loc} ${msg}`.trimEnd(),
  });
  const pages = checkWiki(root, add);
  if (flags.env || flags.debt || flags.coverage) {
    const fm = pages.get('infra/00-stack')?.fm ?? {};
    const resolved = (v) => typeof v === 'string' && v !== '' && !v.includes('{{');
    const roots = Array.isArray(fm.source_roots) ? fm.source_roots.map(trimSlash) : [];
    if (!roots.length || !roots.every(resolved)) {
      add('BLOCKED', 'config', `${STACK}:1`, 'source_roots is unresolved (run the workflow-init skill)');
    } else {
      const cfg = { roots, integration: resolved(fm.integration) ? fm.integration : null };
      const files = sourceFiles(root, roots);
      if (flags.env) checkEnv(root, files, add);
      if (flags.debt) checkDebt(root, files, add);
      if (flags.coverage) checkCoverage(root, files, pages, cfg, add, branchRule);
    }
  }
  return findings;
}

function exitCode(findings) {
  if (findings.some((f) => f.level === 'FAIL')) return 1;
  return findings.some((f) => f.level === 'BLOCKED') ? 2 : 0;
}

// 10. the pass fixture is clean; the fail fixture trips each check exactly once.
function selfTest() {
  const all = { env: true, debt: true, coverage: true };
  const bad = (name) => run(join(HERE, 'fixtures', name), all, false).filter((f) => f.level !== 'INFO');
  const errors = bad('pass').map((f) => `pass fixture: unexpected ${f.text}`);
  const failing = bad('fail');
  for (const c of CHECKS) {
    const n = failing.filter((f) => f.level === 'FAIL' && f.check === c).length;
    if (n !== 1) errors.push(`fail fixture: expected exactly one FAIL [${c}], got ${n}`);
  }
  if (failing.length !== CHECKS.length) {
    errors.push(`fail fixture: expected ${CHECKS.length} findings, got:`, ...failing.map((f) => `  ${f.text}`));
  }
  const tmp = mkdtempSync(join(tmpdir(), 'vw-test-'));
  try {
    cpSync(join(HERE, 'fixtures', 'pass'), tmp, { recursive: true });
    writeFileSync(join(tmp, 'src/greet.mjs'), "export const apiKey = import.meta.env['API_KEY'];\nexport const greet = (name) => `Hello, ${name}`;\n");
    const envOut = run(tmp, all, false).filter((f) => f.level !== 'INFO');
    if (envOut.length) errors.push(`import.meta.env['...'] unexpected: ${envOut.map((f) => f.text).join('; ')}`);

    const comp = join(tmp, 'wiki/contracts/components/greet.md');
    const baseComp = readFileSync(comp, 'utf8');
    writeFileSync(comp, baseComp.replace('status: locked', 'status: draft'));
    const draftInfo = run(tmp, { coverage: true }, false).find((f) => f.level === 'INFO')?.text ?? '';
    if (!draftInfo.includes('specified=0%')) errors.push(`draft should not count as specified: ${draftInfo}`);

    writeFileSync(comp, baseComp.replace('implements: [FR-001]', 'implements: []').replace('tests: [src/greet-test.txt]', 'tests: []'));
    if (!run(tmp, {}, false).some((f) => f.check === 'trace' && f.text.includes('requires at least one tests path'))) {
      errors.push('implementation: done with tests: [] did not fail trace');
    }

    writeFileSync(comp, baseComp.replace('target: src/greet.mjs', 'target: [src/greet.mjs, src/other.mjs]'));
    if (!run(tmp, {}, false).some((f) => f.check === 'frontmatter' && f.text.includes('target must be a single path'))) {
      errors.push('array target did not fail frontmatter cleanly');
    }
    writeFileSync(comp, baseComp);

    const feat = join(tmp, 'wiki/features/greet.md');
    writeFileSync(feat, `${readFileSync(feat, 'utf8')}\nThe text \`[[nowhere/page]]\` is literal, and so is \`\` [[nowhere/page]] \`\`.\n`);
    const ui = join(tmp, 'wiki/contracts/ui/greet.md');
    const uiPage = '---\nstatus: locked\nmockup: mockups/greet.html\napproved-by: Ana 2026-01-31\n---\n# Greet screen\n\nServes `FR-001`.\n';
    mkdirSync(join(tmp, 'wiki/contracts/ui/mockups'), { recursive: true });
    writeFileSync(join(tmp, 'wiki/contracts/ui/mockups/greet.html'), '<!doctype html><title>greet</title>\n');
    writeFileSync(ui, uiPage);
    const index = join(tmp, 'wiki/00-index.md');
    writeFileSync(index, `${readFileSync(index, 'utf8')}- [[contracts/ui/greet]]\n`);
    const uiOut = run(tmp, {}, false).filter((f) => f.level !== 'INFO');
    if (uiOut.length) errors.push(`inline-code link or approved UI contract unexpected: ${uiOut.map((f) => f.text).join('; ')}`);
    writeFileSync(ui, uiPage.replace('status: locked', 'status: draft'));
    writeFileSync(comp, `${baseComp}\nFollows [[contracts/ui/greet]].\n`);
    if (!run(tmp, {}, false).some((f) => f.check === 'links' && f.text.includes('links draft [[contracts/ui/greet]]'))) {
      errors.push('locked page linking a draft page did not fail links');
    }
    writeFileSync(comp, baseComp);
    writeFileSync(ui, uiPage.replace('approved-by: Ana 2026-01-31\n', ''));
    if (!run(tmp, {}, false).some((f) => f.check === 'frontmatter' && f.text.includes('approved-by'))) {
      errors.push('locked UI contract without approved-by did not fail frontmatter');
    }
    writeFileSync(ui, uiPage);

    // Branch rule of coverage: a local repository on `main`, then a branch adding and changing code under no locked page.
    const env = {
      ...process.env, GIT_AUTHOR_NAME: 'ana', GIT_AUTHOR_EMAIL: 'ana@example.invalid', GIT_COMMITTER_NAME: 'ana',
      GIT_COMMITTER_EMAIL: 'ana@example.invalid', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false',
    };
    const g = (...a) => capture('git', a, { cwd: tmp, env }).status === 0;
    if (!(g('init', '-q', '-b', 'main') && g('add', '-A') && g('commit', '-q', '-m', 'seed') && g('switch', '-q', '-c', 'feat/x'))) {
      errors.push('branch rule: git init/commit failed in a temporary directory');
    } else {
      const cov = () => run(tmp, { coverage: true }, true).filter((f) => f.level !== 'INFO').map((f) => f.text);
      const clean = cov();
      if (clean.length) errors.push(`branch rule: clean branch unexpected: ${clean.join('; ')}`);
      writeFileSync(join(tmp, 'src/legacy/new.mjs'), 'export const n = 1;\n');
      if (!cov().some((t) => t.includes('src/legacy/new.mjs added without spec'))) errors.push('branch rule: added legacy file did not fail coverage');
      rmSync(join(tmp, 'src/legacy/new.mjs'));
      const old = join(tmp, 'src/legacy/old.mjs');
      writeFileSync(old, `${readFileSync(old, 'utf8')}// changed\n`);
      if (!cov().some((t) => t.includes('src/legacy/old.mjs changed without spec'))) errors.push('branch rule: changed legacy file did not fail coverage');
      writeFileSync(join(tmp, 'src/greet.mjs'), `${readFileSync(join(tmp, 'src/greet.mjs'), 'utf8')}// changed\n`);
      if (cov().some((t) => t.includes('src/greet.mjs'))) errors.push('branch rule: change under a locked page failed coverage');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const e of errors) console.log(`FAIL [self-test] ${e}`);
  if (!errors.length) console.log(`SELF_TEST_OK ${CHECKS.length} checks`);
  process.exit(errors.length ? 1 : 0);
}

const args = process.argv.slice(2);
const known = ['--check-env', '--check-debt', '--check-coverage', '--self-test'];
const unknown = args.filter((a) => !known.includes(a));
if (unknown.length) {
  console.log(`BLOCKED [usage] unknown argument ${unknown.join(' ')}`);
  process.exit(2);
}
if (args.includes('--self-test')) selfTest();
const findings = run(join(HERE, '..'), {
  env: args.includes('--check-env'), debt: args.includes('--check-debt'), coverage: args.includes('--check-coverage'),
}, true);
for (const f of findings) console.log(f.text);
const code = exitCode(findings);
if (code === 0) console.log('WIKI_OK');
process.exit(code);
