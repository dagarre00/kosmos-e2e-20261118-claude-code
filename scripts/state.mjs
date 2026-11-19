#!/usr/bin/env node
// state.mjs: the only writer of STATE.md. Exit 0 PASS, 1 FAIL, 2 BLOCKED.
// Usage: node scripts/state.mjs next | claim | gate | test | verify | ci | pre-push | --self-test (see scripts/README.md)
import { spawnSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'STATE.md');
const STACK = 'wiki/infra/00-stack.md';
const GATES = ['grill-me', 'sync-wiki', 'plan-adversary', 'build', 'pr-adversary', 'pr'];
const BIG = ['plan-adversary', 'build', 'pr-adversary', 'pr'];
const REQUIRED = { S: ['build', 'pr'], M: BIG, L: BIG };
const SIZES = ['S', 'M', 'L'];
const S_BUDGET = 150;
const BUDGET_SLACK = 1.25;
const FIELDS = ['Branch', 'Claim', 'Active TODO', 'Size', 'Gate', 'Read next', 'Plan', 'Last green', 'Next action'];
const CLAIM_RE = /^chore\((T-\d{3})\): claim (\S+) \[([SML])\] gate=(\S+)$/;
const RESIZE_RE = /^chore\((T-\d{3})\): resize \[([SML])\]$/;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// ---- pure rules (covered by --self-test) ----

// Null when the move is legal, else the reason. `from` is null when claiming.
function moveError(size, from, to, prevSize = size) {
  const a = from === null ? -1 : GATES.indexOf(from);
  const b = GATES.indexOf(to);
  if (b < 0) return `unknown gate ${to}`;
  if (b === a) return `already at ${to}`;
  if (prevSize === 'S' && size !== 'S' && a >= GATES.indexOf('build') && b > GATES.indexOf('plan-adversary')) {
    return `raising [S] to [${size}] mid-build must go through plan-adversary`;
  }
  if (b < a) return null;
  const skipped = GATES.slice(a + 1, b).filter((g) => REQUIRED[size].includes(g));
  return skipped.length ? `${to} skips required ${skipped.join(', ')} for [${size}]` : null;
}

// Findings table rows: | severity | file:line | rule | fix | status |, markdown emphasis ignored.
function planRows(text) {
  const stripMd = (s) => s.replace(/[*_`]/g, '').trim();
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/\|$/, '').split('|').slice(1).map(stripMd);
    if (cells.length < 5 || !SEVERITIES.includes(cells[0].toUpperCase())) continue;
    out.push({ severity: cells[0].toUpperCase(), loc: cells[1], status: cells[cells.length - 1].toLowerCase() });
  }
  return out;
}

// Rows that block the build gate: CRITICAL unless fixed, HIGH unless fixed or waived by a named human.
function planBlockers(text) {
  return planRows(text).filter(({ severity, status }) => status !== 'fixed'
    && (severity === 'CRITICAL' || (severity === 'HIGH' && !/^waived-by:\S+/.test(status))))
    .map(({ severity, loc, status }) => `${severity} ${loc} is ${status || 'open'}`);
}

// A reviewed plan carries findings rows, or the line "Findings: none" when the review was clean.
const planReviewed = (text) => planRows(text).length > 0 || /^Findings:\s*none\b/im.test(text);

// Unticked and ticked TODO.md lines: - [ ] T-XXX | slug | [S] | type | page | ids | criterion [| after:T-XXX,T-YYY]
function todoRows(text) {
  return text.split(/\r?\n/).map((l) => {
    const m = /^- \[( |x)\] (T-\d{3}) \|/.exec(l);
    if (!m) return null;
    const c = l.split('|').map((s) => s.trim());
    const dep = /^after:\s*(.*)$/.exec(c[7] ?? '');
    const after = dep ? dep[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    return { id: m[2], done: m[1] === 'x', slug: c[1] ?? '', type: c[3] ?? '', page: c[4] ?? '', ids: c[5] ?? '', after, raw: l.slice(6) };
  }).filter(Boolean);
}

// Prerequisites of a row that are not ticked in the same TODO.md (an unknown ID never counts as done).
const waitingOn = (row, rows) => row.after.filter((id) => !rows.some((r) => r.id === id && r.done));

// Code needs a locked spec: a task linked to a wiki page cannot enter build until that page is locked or legacy.
function specError(page, status) {
  if (!/^wiki\/.+\.md$/.test(page)) return null;
  return ['locked', 'legacy'].includes(status) ? null : `${page} is ${status ?? 'missing'}; lock it with sync-wiki before build`;
}

// Markdown anywhere, anything under wiki/ (UI mockups) and the workflow's own config files are not application code;
// a branch with no changes yet (right after claim) is docs-only too.
const NON_CODE = new Set(['.gitignore', '.gitattributes', '.env.example', 'scripts/preview.mjs']);
const docsOnly = (files) => files.every((f) => f.endsWith('.md') || f.startsWith('wiki/') || NON_CODE.has(f));

// A new [M]/[L] task's plan path, so plan-adversary and build find it without --plan.
const defaultPlan = (todo, size) => (size === 'S' ? '—' : `plans/${todo}.md`);

function planBudget(text) {
  const m = /^Budget:\s*(\d+)/m.exec(text);
  return m ? Number(m[1]) : null;
}

// Largest size among the claim and any later "resize" commits of the same task.
function taskSize(subjects, todo, claimed) {
  const sizes = [claimed, ...subjects.map((x) => RESIZE_RE.exec(x)).filter((r) => r && r[1] === todo).map((r) => r[2])];
  return SIZES[Math.max(...sizes.map((x) => SIZES.indexOf(x)))];
}

// Remote refs a push would update on a protected branch. Input: the pre-push hook's stdin,
// one "<local ref> <local sha> <remote ref> <remote sha>" line per ref.
const pushedProtected = (input, branches) => (input ? input.split(/\r?\n/) : [])
  .map((l) => l.trim().split(/\s+/)[2]).filter((ref) => ref && branches.some((b) => ref === `refs/heads/${b}`));

// The pr-adversary output pasted in a PR body: the last "Reviewed: <sha>" and the last VERDICT line.
function prVerdict(body) {
  const text = (body ?? '').replace(/\r\n/g, '\n');
  const last = (re) => [...text.matchAll(re)].pop()?.[1] ?? null;
  return { reviewed: last(/^Reviewed:\s*`?([0-9a-f]{7,40})`?\s*$/gm), verdict: last(/^VERDICT:\s*(PASS|BLOCKED)\s*$/gm) };
}

// ---- output ----

const findings = [];
const fail = (check, msg) => findings.push([1, `FAIL [${check}] ${msg}`]);
const blocked = (check, msg) => findings.push([2, `BLOCKED [${check}] ${msg}`]);
function finish(okLine) {
  for (const [, line] of findings) console.log(line);
  const code = findings.some(([c]) => c === 1) ? 1 : findings.length ? 2 : 0;
  if (code === 0 && okLine) console.log(okLine);
  process.exit(code);
}

// ---- git and config ----

// A sandbox may deny named pipes, so child stdout/stderr go through files, not `stdio: 'pipe'`.
function capture(command, args, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'state-run-'));
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

// Git transport needs a pipe for its prompt/helper on Windows; a sandbox can deny it.
const SANDBOX_RE = /signal pipe|failed to execute prompt script/i;
const sandboxFailure = (e) => process.platform === 'win32' && SANDBOX_RE.test(String(e.stderr || e.message));
const SANDBOX_HINT = 'Git transport is blocked by the sandbox; rerun this command with wider permissions';

const git = (args) => {
  const r = capture('git', args, { cwd: ROOT });
  if (r.status !== 0) throw Object.assign(new Error(r.stderr || `git exited ${r.status}`), { stderr: r.stderr });
  return r.stdout.trim();
};
const tryGit = (args) => { try { return git(args); } catch { return null; } };
const refExists = (ref) => tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
const dirty = () => git(['status', '--porcelain']) !== '';
const branch = () => tryGit(['symbolic-ref', '--quiet', '--short', 'HEAD']);
const lines = (s) => (s ? s.split(/\r?\n/).filter(Boolean) : []);
const hasOrigin = () => lines(git(['remote'])).includes('origin');
// TODO.md as the integration branch has it, so a stale checkout cannot claim a finished task.
const todoText = (ref) => (ref ? tryGit(['show', `${ref}:TODO.md`]) ?? '' : '');
const claimRef = (name) => [`refs/remotes/origin/${name}`, `refs/heads/${name}`].find(refExists);
// A wiki page's frontmatter at `ref`, or in the working tree when ref is null; null when the page is missing.
function pageFm(page, ref) {
  const text = ref ? tryGit(['show', `${ref}:${page}`]) : existsSync(join(ROOT, page)) ? readFileSync(join(ROOT, page), 'utf8') : null;
  return (text && /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]) ?? null;
}
// A wiki page's status; undefined when the page is missing.
const pageStatus = (page, ref) => /^status:\s*(\S+)/m.exec(pageFm(page, ref) ?? '')?.[1];
// Code needs locked specs: the task's linked page and every component page implementing one of its IDs.
function specErrors(row, ref) {
  if (!row) return [];
  const ids = row.ids.match(/\b(?:US|FR|NFR)-\d{3}\b/g) ?? [];
  const dir = 'wiki/contracts/components';
  const listed = ids.length ? lines(tryGit(ref ? ['ls-tree', '-r', '--name-only', ref, '--', dir]
    : ['ls-files', '--cached', '--others', '--exclude-standard', '--', dir]) ?? '') : [];
  const comps = listed.filter((p) => p.endsWith('.md') && !/(^|\/)(00-[^/]*|_template)\.md$/.test(p)).filter((p) => {
    const m = /^implements:\s*\[(.*)\]/m.exec(pageFm(p, ref) ?? '');
    return m && m[1].split(',').map((x) => x.trim()).some((id) => ids.includes(id));
  });
  return [row.page, ...comps].map((p) => specError(p, pageStatus(p, ref))).filter(Boolean);
}
// The active task's TODO.md line: as the integration branch has it, else as this branch has it.
function activeRow(id) {
  const local = existsSync(join(ROOT, 'TODO.md')) ? readFileSync(join(ROOT, 'TODO.md'), 'utf8') : '';
  return [todoText(baseRef()), local].flatMap((t) => todoRows(t).filter((r) => r.id === id))[0];
}

// verify-wiki.mjs, quiet on pass: prints its findings (minus DRAFT_GAP notes) only when it does not exit 0.
function runWiki(flags) {
  const r = capture(process.execPath, [join(ROOT, 'scripts', 'verify-wiki.mjs'), ...flags], { cwd: ROOT });
  if (r.status !== 0) for (const l of lines(r.stdout || r.stderr)) if (!l.startsWith('DRAFT_GAP')) console.log(l);
  return r.status;
}

// Project settings live in the frontmatter of the stack page, so the wiki stays the one source.
function config() {
  const raw = {};
  const path = join(ROOT, STACK);
  const fm = existsSync(path) ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, 'utf8')) : null;
  for (const l of fm ? fm[1].split(/\r?\n/) : []) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(l);
    if (m) raw[m[1]] = m[2].trim();
  }
  const value = (v) => (v && !v.includes('{{') ? v : null);
  const list = (v) => (value(v) ? v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean) : []);
  return {
    integration: value(raw.integration),
    default: value(raw.default),
    installCmd: value(raw.install_cmd),
    verifyCmd: value(raw.verify_cmd),
    roots: list(raw.source_roots),
    testGlob: list(raw.test_glob),
  };
}
const unresolved = (key) => `${key} is unresolved in ${STACK} (run the workflow-init skill)`;

function baseRef() {
  const { integration } = config();
  if (!integration) return null;
  return [`origin/${integration}`, integration].find(refExists) ?? null;
}
const mergeBase = () => { const b = baseRef(); return b ? tryGit(['merge-base', b, 'HEAD']) : null; };

// Files changed on the branch, including uncommitted and untracked ones.
function changed(mb) {
  return [...lines(git(['diff', '--name-only', mb])), ...lines(git(['ls-files', '--others', '--exclude-standard']))];
}

// ---- STATE.md ----

function writeState(s) {
  writeFileSync(STATE, `${['# STATE (written only by scripts/state.mjs)', ...FIELDS.map((k) => `${k}: ${s[k]}`)].join('\n')}\n`);
}

const nextAction = (gate) => ({ build: 'build to the acceptance criteria', pr: 'open the PR' }[gate] ?? `run the ${gate} skill`);

// STATE.md for this branch, or rebuilt from the claim commit at its initial gate, or null when idle.
function readState() {
  const current = branch();
  if (existsSync(STATE)) {
    const s = {};
    for (const l of readFileSync(STATE, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z][A-Za-z ]+):\s*(.*)$/.exec(l);
      if (m) s[m[1]] = m[2];
    }
    if (/^T-\d{3}$/.test(s['Active TODO'] ?? '') && s.Branch === current) return s;
  }
  const base = baseRef();
  if (!base || !current) return null;
  const subjects = lines(git(['log', '--format=%s', `${base}..HEAD`]));
  const m = subjects.map((subject) => CLAIM_RE.exec(subject)).filter(Boolean).pop();
  if (!m) return null;
  // Size raises are recorded as empty "resize" commits; a raised task restarts no later than plan-adversary.
  const size = taskSize(subjects, m[1], m[3]);
  const gate0 = size !== m[3] && GATES.indexOf(m[4]) > GATES.indexOf('plan-adversary') ? 'plan-adversary' : m[4];
  const s = {
    Branch: current,
    Claim: refExists(`refs/remotes/origin/${current}`) ? 'remote' : 'local-only',
    'Active TODO': m[1],
    Size: size,
    Gate: gate0,
    'Read next': 'TODO.md, wiki/00-index.md',
    Plan: defaultPlan(m[1], size),
    'Last green': 'none',
    'Next action': nextAction(gate0),
  };
  writeState(s);
  return s;
}

// ---- commands ----

function claim(o) {
  const { todo, type, slug, size, gate } = o;
  const valid = [todo, type, slug, size, gate].every((v) => typeof v === 'string')
    && /^T-\d{3}$/.test(todo) && /^[a-z]+$/.test(type) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
    && SIZES.includes(size) && GATES.includes(gate);
  if (!valid) {
    fail('usage', 'claim --todo T-XXX --type <type> --slug <slug> --size <S|M|L> --gate <gate>');
    finish();
  }
  const move = moveError(size, null, gate);
  if (move) fail('gate', move);
  const { integration } = config();
  if (!integration) blocked('config', unresolved('integration'));
  const start = branch(); // null in a detached worktree made for one batch worker
  const startSha = tryGit(['rev-parse', 'HEAD']);
  if (!start && !startSha) blocked('git', 'HEAD has no commit');
  if (dirty()) blocked('tree', 'working tree is not clean');
  const name = `${type}/${slug}`;
  const remote = hasOrigin();
  if (remote) {
    try { git(['fetch', '--prune', 'origin']); }
    catch (e) {
      if (sandboxFailure(e)) blocked('sandbox', SANDBOX_HINT);
      else blocked('remote', 'origin cannot be reached');
      finish();
    }
  }
  const base = remote ? `origin/${integration}` : integration;
  const hasBase = !!integration && refExists(base);
  if (integration && !hasBase) blocked('git', `${base} does not exist`);
  // The branch name is the lock, so it must be the one name the TODO.md line gives this task.
  const all = todoRows(todoText(hasBase ? base : null));
  const rows = all.filter((r) => r.id === todo);
  const row = rows[0];
  if (rows.length > 1) blocked('todo', `${todo} appears ${rows.length} times in TODO.md on ${base}; renumber the newer line`);
  else if (hasBase && (!row || row.done)) blocked('todo', `${todo} is not an unticked line in TODO.md on ${base}`);
  else if (row && (row.type !== type || row.slug !== slug)) fail('usage', `${todo} must be claimed as ${row.type}/${row.slug}, the name on its TODO.md line`);
  if (row && waitingOn(row, all).length) blocked('todo', `${todo} waits on ${waitingOn(row, all).join(', ')} (after: in TODO.md)`);
  if (gate === 'build') for (const e of specErrors(row, hasBase ? base : null)) fail('spec', e);
  if (claimRef(name)) blocked('branch', `${name} already exists (claimed; run node scripts/state.mjs next)`);
  if (findings.length) finish();

  git(['switch', '--no-track', '-c', name, base]);
  git(['commit', '--allow-empty', '-m', `chore(${todo}): claim ${slug} [${size}] gate=${gate}`]);
  let kind = 'local-only';
  if (remote) {
    let pushError = null;
    try { git(['push', '-u', 'origin', name]); kind = 'remote'; }
    catch (e) { pushError = e; }
    if (pushError && sandboxFailure(pushError)) {
      git(['switch', ...(start ? [start] : ['--detach', startSha])]);
      git(['branch', '-D', name]);
      blocked('sandbox', SANDBOX_HINT);
      finish();
    } else if (pushError && tryGit(['ls-remote', '--exit-code', '--heads', 'origin', name]) !== null) {
      git(['switch', ...(start ? [start] : ['--detach', startSha])]);
      git(['branch', '-D', name]);
      blocked('claim', `${name} was claimed on origin first (lost the race)`);
      finish();
    }
  }
  const { page } = row;
  writeState({
    Branch: name,
    Claim: kind,
    'Active TODO': todo,
    Size: size,
    Gate: gate,
    'Read next': `TODO.md, ${/^wiki\/.+\.md$/.test(page) ? page : 'wiki/00-index.md'}`,
    Plan: defaultPlan(todo, size),
    'Last green': 'none',
    'Next action': nextAction(gate),
  });
  ensureHooks();
  if (kind === 'local-only') console.log(`WARN local-only claim: ${remote ? 'the push failed' : 'no origin remote'}, so the branch is no lock for anyone else`);
  finish(`PASS claimed ${name} (${kind}) gate=${gate}`);
}

// The pre-push hook refuses pushes to the protected branches. Enable it in this clone unless
// another hook setup (core.hooksPath, or hooks already installed) owns it.
function ensureHooks() {
  if (!existsSync(join(ROOT, '.githooks', 'pre-push')) || tryGit(['config', '--get', 'core.hooksPath']) !== null) return;
  const dir = resolve(ROOT, git(['rev-parse', '--git-path', 'hooks']));
  const own = existsSync(dir) ? readdirSync(dir).filter((f) => !f.endsWith('.sample')) : [];
  if (own.length) {
    console.log(`WARN hooks: ${own.join(', ')} already installed in ${dir}; add .githooks/pre-push to that setup`);
    return;
  }
  git(['config', 'core.hooksPath', '.githooks']);
  console.log('INFO hooks: enabled .githooks/pre-push (git config core.hooksPath .githooks)');
}

// Unticked tasks in TODO.md order, each FREE, WAITING (an after: task is unticked) or CLAIMED (its branch exists),
// up to the --limit-th FREE one (default 3).
function next(o) {
  const limit = o.limit === undefined ? 3 : Number(o.limit);
  if (!Number.isInteger(limit) || limit < 1) { fail('usage', 'next [--limit <n>], n a positive integer'); finish(); }
  const { integration } = config();
  if (!integration) { blocked('config', unresolved('integration')); finish(); }
  if (hasOrigin()) {
    try { git(['fetch', '--prune', 'origin']); }
    catch (e) {
      console.log(sandboxFailure(e)
        ? 'WARN Git transport is blocked by the sandbox; rerun with wider permissions for fresh claims'
        : 'WARN origin cannot be reached; claims may be stale');
    }
  }
  const base = baseRef();
  if (!base) { blocked('git', `${integration} does not exist`); finish(); }
  let free = 0;
  const all = todoRows(todoText(base));
  for (const r of all.filter((x) => !x.done)) {
    const name = `${r.type}/${r.slug}`;
    const ref = claimRef(name);
    const waiting = waitingOn(r, all);
    if (ref) console.log(`CLAIMED ${r.id} ${name} (${git(['log', '-1', '--format=%an, %cr', ref])})`);
    else if (waiting.length) console.log(`WAITING ${r.id} ${name} (after ${waiting.join(', ')})`);
    else {
      console.log(`FREE ${r.raw}`);
      if (++free === limit) break;
    }
  }
  finish(free ? undefined : 'NONE no free task in TODO.md');
}

function checkPlan(plan) {
  if (!plan || !existsSync(join(ROOT, plan))) return fail('plan', 'plan file is missing (pass --plan plans/T-XXX.md)');
  const text = readFileSync(join(ROOT, plan), 'utf8');
  if (planBudget(text) === null) fail('plan', `${plan} has no "Budget: <n>" line`);
  if (!planReviewed(text)) fail('plan', `${plan} is not reviewed: run plan-adversary, then add its rows or the line "Findings: none"`);
  for (const b of planBlockers(text)) fail('plan', `${plan} ${b}`);
  return undefined;
}

// Clean tree, green at HEAD, and non-test source changes within budget.
function verifyChecks(s, size, plan) {
  if (dirty()) fail('tree', 'working tree is not clean');
  const green = s['Last green'];
  const known = !!green && green !== 'none' && refExists(green);
  if (!known || tryGit(['diff', '--quiet', green, 'HEAD']) === null) {
    fail('green', `Last green (${known ? green.slice(0, 7) : 'none'}) does not match HEAD; run node scripts/state.mjs test`);
  }
  return budgetCheck(size, plan, mergeBase(), 'HEAD');
}

// Changed non-test lines under the source roots between two commits, within the task's budget.
function budgetCheck(size, plan, from, to) {
  const cfg = config();
  if (!cfg.roots.length) return blocked('config', unresolved('source_roots'));
  if (!from) return blocked('config', unresolved('integration'));
  let limit = S_BUDGET;
  if (size !== 'S') {
    const budget = plan && existsSync(join(ROOT, plan)) ? planBudget(readFileSync(join(ROOT, plan), 'utf8')) : null;
    if (budget === null) return fail('budget', `[${size}] needs a plan with a "Budget: <n>" line`);
    limit = Math.floor(budget * BUDGET_SLACK);
  }
  const stat = git(['diff', '--numstat', from, to, '--', ...cfg.roots, ...cfg.testGlob.map((g) => `:(exclude,glob)${g}`)]);
  const total = lines(stat).reduce((n, l) => {
    const [added, deleted] = l.split('\t');
    return n + (Number(added) || 0) + (Number(deleted) || 0);
  }, 0);
  if (total > limit) {
    fail('budget', `${total} changed non-test lines > ${limit}; cut code, or raise the size or the plan's Budget`);
  }
  return undefined;
}

function gate(o) {
  const s = readState();
  if (!s) {
    blocked('state', 'no active task on this branch (run the next-todo skill)');
    finish();
  }
  let size = s.Size;
  if (o.size !== undefined) {
    if (!SIZES.includes(o.size)) fail('size', `unknown size ${o.size}`);
    else if (SIZES.indexOf(o.size) < SIZES.indexOf(size)) fail('size', `size may only go up (${size} -> ${o.size})`);
    else size = o.size;
  }
  const to = o.set;
  // A finishing gate may be re-run in place (after a late commit, such as the TODO.md tick): every check runs again.
  const recheck = to === s.Gate && size === s.Size && ['pr-adversary', 'pr'].includes(to);
  const move = recheck ? null : moveError(size, s.Gate, to, s.Size);
  if (move) fail('gate', move);
  const plan = typeof o.plan === 'string' ? o.plan : s.Plan !== '—' ? s.Plan : null;
  const readNext = typeof o.read === 'string' ? o.read.split(',').map((p) => p.trim()).filter(Boolean) : null;
  if (readNext && (readNext.length < 2 || readNext.length > 4)) fail('read', '--read takes 2-4 comma-separated paths');
  if (!move) {
    const big = size !== 'S';
    const finishing = to === 'pr-adversary' || to === 'pr';
    if (finishing && hasOrigin()) {
      try { git(['fetch', '--prune', 'origin']); }
      catch (e) { if (sandboxFailure(e)) blocked('sandbox', SANDBOX_HINT); }
    } // best effort: see what others merged
    const mb = mergeBase();
    if (['plan-adversary', 'build'].includes(to) && mb && changed(mb).some((f) => f.startsWith('wiki/'))) {
      const code = runWiki([]);
      if (code !== 0) fail('wiki', `the branch touches wiki/ and verify-wiki.mjs exited ${code}`);
    }
    if (to === 'build' && big) checkPlan(plan);
    if (to === 'build') {
      for (const e of specErrors(activeRow(s['Active TODO']), null)) fail('spec', e);
    }
    if (finishing) {
      const base = baseRef();
      if (base && mb && mb !== git(['rev-parse', base])) {
        fail('rebase', `branch is behind ${base}; rebase onto it, then rerun node scripts/state.mjs test`);
      }
      const code = runWiki(['--check-env', '--check-debt', '--check-coverage']);
      if (code === 2) blocked('wiki', 'verify-wiki.mjs exited 2');
      else if (code !== 0) fail('wiki', `verify-wiki.mjs exited ${code}`);
      verifyChecks(s, size, plan);
    }
    if (to === 'pr' && big) {
      // The verdict is bound to the commit the audit saw: any later change needs a new pr-adversary run.
      const seen = typeof o.reviewed === 'string' && refExists(o.reviewed) ? o.reviewed : null;
      if (o.verdict !== 'PASS') fail('verdict', '--verdict PASS from pr-adversary is required');
      else if (!seen || tryGit(['diff', '--quiet', seen, 'HEAD']) === null) {
        fail('verdict', '--reviewed <sha> must be the commit pr-adversary printed, with no diff to HEAD; rerun pr-adversary after any change');
      }
    }
  }
  if (findings.length) finish();
  if (size !== s.Size) { // an empty commit keeps the tree, so Last green stays valid, and survives a lost STATE.md
    const sha = git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', `chore(${s['Active TODO']}): resize [${size}]`]);
    git(['update-ref', 'HEAD', sha]);
  }
  writeState({
    ...s,
    Size: size,
    Gate: to,
    'Read next': readNext ? readNext.join(', ') : s['Read next'],
    Plan: plan ?? '—',
    'Next action': typeof o.next === 'string' ? o.next : nextAction(to),
  });
  finish(`PASS gate=${to} size=${size}`);
}

// Runs the full verify command; a partial run can never stamp because no arguments are accepted.
function test(argv) {
  if (argv.length) {
    fail('usage', 'test takes no arguments');
    finish();
  }
  const s = readState();
  const mb = mergeBase();
  const files = mb ? changed(mb) : [];
  let label = 'PASS';
  if (mb && docsOnly(files)) label = 'PASS (docs-only)';
  else {
    const { verifyCmd } = config();
    if (!verifyCmd) {
      blocked('test', `VERIFY_CMD_UNRESOLVED set verify_cmd in ${STACK}`);
      finish();
    }
    const r = spawnSync(verifyCmd, { cwd: ROOT, shell: true, stdio: 'inherit' });
    if (r.status !== 0) {
      fail('test', `"${verifyCmd}" exited ${r.status}`);
      finish();
    }
  }
  if (dirty()) finish(`${label} | UNSTAMPED (commit first)`);
  const head = git(['rev-parse', 'HEAD']);
  if (s) writeState({ ...s, 'Last green': head });
  finish(s ? `${label} | Last green: ${head.slice(0, 7)}` : label);
}

// A pull request as CI sees it: from flags, else from the GitHub Actions event; null on a push.
function prContext(o) {
  if (typeof o.head === 'string') {
    const body = typeof o['body-file'] === 'string' ? readFileSync(o['body-file'], 'utf8') : '';
    return { head: o.head, headRef: String(o['head-ref'] ?? ''), base: String(o.base ?? ''), body };
  }
  const { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: path } = process.env;
  if (!name?.startsWith('pull_request') || !path) return null;
  const e = JSON.parse(readFileSync(path, 'utf8')).pull_request;
  return { head: e.head.sha, headRef: e.head.ref, base: e.base.ref, body: e.body ?? '' };
}

// The gates, re-checked where there is no STATE.md: claim, tick, plan, budget and the bound verdict.
function prChecks(pr, cfg) {
  if (pr.base !== cfg.integration) {
    if (pr.base === cfg.default && pr.headRef === cfg.integration) {
      console.log(`INFO release PR ${cfg.integration} -> ${cfg.default}: task checks skipped`);
      return;
    }
    fail('pr', `task PRs target ${cfg.integration}, not ${pr.base}`);
    return;
  }
  const base = baseRef();
  if (!refExists(pr.head)) { blocked('git', `PR head ${pr.head} is not in this clone; fetch full history`); return; }
  const subjects = lines(git(['log', '--format=%s', `${base}..${pr.head}`]));
  const m = subjects.map((x) => CLAIM_RE.exec(x)).filter(Boolean).pop();
  // The workflow-init PR is the one task with no claim commit: its base still holds the template.
  const baseIntegration = /^integration:\s*(.*)$/m.exec(pageFm(STACK, base) ?? '')?.[1] ?? '';
  if (!m && (!baseIntegration || baseIntegration.includes('{{'))) {
    console.log('INFO bootstrap PR (the base is not initialized): task checks skipped');
    return;
  }
  if (!m) { fail('claim', `no "chore(T-XXX): claim" commit on ${pr.headRef}; start every task with the next-todo skill`); return; }
  const [, todo, , claimed] = m;
  const row = todoRows(todoText(base)).find((r) => r.id === todo);
  if (!row) fail('todo', `${todo} is not a line of TODO.md on ${base}`);
  else if (pr.headRef !== `${row.type}/${row.slug}`) fail('claim', `${todo} is claimed as ${row.type}/${row.slug}, but the PR comes from ${pr.headRef}`);
  if (!todoRows(todoText(pr.head)).find((r) => r.id === todo)?.done) fail('todo', `${todo} is not ticked in the PR's TODO.md`);
  const size = taskSize(subjects, todo, claimed);
  const plan = defaultPlan(todo, size);
  if (size !== 'S') checkPlan(plan);
  budgetCheck(size, size === 'S' ? null : plan, tryGit(['merge-base', base, pr.head]), pr.head);
  if (size === 'S') return;
  const { reviewed, verdict } = prVerdict(pr.body);
  if (verdict !== 'PASS' || !reviewed) {
    fail('verdict', `[${size}] PR body needs the pr-adversary output: a "Reviewed: <sha>" line and a last line "VERDICT: PASS"`);
  } else if (!refExists(reviewed) || tryGit(['diff', '--quiet', reviewed, pr.head]) === null) {
    fail('verdict', `Reviewed: ${reviewed} differs from the PR head; rerun pr-adversary and paste its output in the PR body`);
  }
}

// CI: the wiki checks and the full verify command on every push and PR, plus the gate checks on a task PR.
function ci(o) {
  const cfg = config();
  if (!cfg.integration) finish('PASS (template) integration is unresolved; run the workflow-init skill to enable the checks');
  const base = baseRef();
  if (!base) { blocked('git', `${cfg.integration} does not exist here; check out full history (fetch-depth 0)`); finish(); }
  const code = runWiki(['--check-env', '--check-debt', '--check-coverage']);
  if (code === 2) blocked('wiki', 'verify-wiki.mjs exited 2');
  else if (code !== 0) fail('wiki', `verify-wiki.mjs exited ${code}`);
  const mb = mergeBase();
  const files = mb ? lines(git(['diff', '--name-only', mb, 'HEAD'])) : [];
  if (mb && docsOnly(files)) console.log('INFO docs-only: verify_cmd not run');
  else if (!cfg.verifyCmd) blocked('test', `VERIFY_CMD_UNRESOLVED set verify_cmd in ${STACK}`);
  else {
    for (const [check, cmd] of [['install', cfg.installCmd], ['test', cfg.verifyCmd]]) {
      if (!cmd) continue;
      const r = spawnSync(cmd, { cwd: ROOT, shell: true, stdio: 'inherit' });
      if (r.status !== 0) { fail(check, `"${cmd}" exited ${r.status}`); break; }
    }
  }
  const pr = prContext(o);
  if (pr) prChecks(pr, cfg);
  finish(pr ? `PASS ci ${pr.headRef} -> ${pr.base}` : 'PASS ci');
}

// Git pre-push hook: nobody pushes to the integration or default branch; they move only by merged PRs.
function prePush() {
  const cfg = config();
  let input = '';
  try { input = readFileSync(0, 'utf8'); } catch { /* no stdin: nothing to push */ }
  for (const ref of pushedProtected(input, [cfg.integration, cfg.default].filter(Boolean))) {
    fail('push', `${ref} is protected: merge through a PR (a human releasing on purpose: git push --no-verify)`);
  }
  finish();
}

// No active task here: STATE.md says so, so a merged task's gate and green do not read as current.
function writeIdle(current) {
  writeState({
    Branch: current, Claim: '—', 'Active TODO': '—', Size: '—', Gate: '—', 'Read next': 'TODO.md, wiki/00-index.md',
    Plan: '—', 'Last green': 'none', 'Next action': 'run the next-todo skill',
  });
}

function verify() {
  const current = branch();
  if (!current) { blocked('git', 'detached HEAD'); finish(); }
  const s = readState();
  if (!s) { writeIdle(current); finish('PASS IDLE'); }
  verifyChecks(s, s.Size, s.Plan !== '—' ? s.Plan : null);
  finish('PASS STATE_OK');
}

// Two clones of one origin run a task end to end: claim lock, gates, rebase rule, size raise, lost STATE.md.
function lifecycleTest(errors) {
  const tmp = mkdtempSync(join(tmpdir(), 'state-test-'));
  const env = {
    ...process.env, GIT_AUTHOR_NAME: 'ana', GIT_AUTHOR_EMAIL: 'ana@example.invalid', GIT_COMMITTER_NAME: 'ana',
    GIT_COMMITTER_EMAIL: 'ana@example.invalid', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.autocrlf',
    GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false',
    GITHUB_EVENT_NAME: '', GITHUB_EVENT_PATH: '', // under CI, `ci` in the test repo must not read the real PR event
  };
  const sh = (cwd, cmd, args) => capture(cmd, args, { cwd, env });
  const g = (cwd, ...args) => {
    const r = sh(cwd, 'git', args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  const state = (cwd, ...args) => {
    const r = sh(cwd, process.execPath, [join(cwd, 'scripts', 'state.mjs'), ...args]);
    return `${r.status} ${r.stdout}`;
  };
  const want = (name, out, code, text = '') => {
    if (!out.startsWith(`${code} `) || !out.includes(text)) errors.push(`lifecycle ${name}: want exit ${code} "${text}", got ${out.trim()}`);
  };
  let sandboxed = false;
  try {
    const [seed, a, b, c] = ['seed', 'a', 'b', 'c'].map((d) => join(tmp, d));
    cpSync(join(ROOT, 'scripts', 'fixtures', 'pass'), seed, { recursive: true });
    for (const f of ['state.mjs', 'verify-wiki.mjs']) cpSync(join(ROOT, 'scripts', f), join(seed, 'scripts', f));
    const stack = join(seed, STACK);
    writeFileSync(stack, readFileSync(stack, 'utf8').replace('verify_cmd: node --test', 'verify_cmd: node --version'));
    writeFileSync(join(seed, '.gitignore'), 'STATE.md\n');
    writeFileSync(join(seed, 'TODO.md'), '- [ ] T-001 | shout | [S] | feat | wiki/features/greet.md | FR-001 | c\n- [ ] T-002 | whisper | [S] | feat | — | — | c\n'
      + '- [ ] T-003 | echo | [S] | feat | — | — | c | after:T-001\n');
    g(seed, 'init', '-q', '-b', 'main');
    g(seed, 'add', '-A');
    g(seed, 'commit', '-q', '-m', 'chore: seed');
    g(tmp, 'clone', '-q', '--bare', 'seed', 'origin.git');
    g(tmp, 'clone', '-q', 'origin.git', 'a');
    g(tmp, 'clone', '-q', 'origin.git', 'b');
    g(tmp, 'clone', '-q', 'origin.git', 'c');

    const listed = state(a, 'next');
    want('next lists free', listed, 0, 'FREE T-001');
    want('next holds a dependent task', listed, 0, 'WAITING T-003 feat/echo (after T-001)');
    want('next --limit', state(a, 'next', '--limit', '1'), 0, 'FREE T-001');
    want('next bad limit', state(a, 'next', '--limit', '0'), 1, '[usage]');
    want('claim a waiting task', state(a, 'claim', '--todo', 'T-003', '--type', 'feat', '--slug', 'echo', '--size', 'S', '--gate', 'build'), 2, 'waits on T-001');
    want('claim under another name', state(a, 'claim', '--todo', 'T-001', '--type', 'feat', '--slug', 'yell', '--size', 'S', '--gate', 'build'), 1, 'feat/shout');
    want('claim', state(a, 'claim', '--todo', 'T-001', '--type', 'feat', '--slug', 'shout', '--size', 'S', '--gate', 'build'), 0, '(remote)');
    const seen = state(b, 'next');
    want('other clone sees the claim', seen, 0, 'CLAIMED T-001 feat/shout');
    want('other clone is offered the next task', seen, 0, 'FREE T-002');
    want('second claim', state(b, 'claim', '--todo', 'T-001', '--type', 'feat', '--slug', 'shout', '--size', 'S', '--gate', 'build'), 2, 'already exists');
    g(c, 'switch', '-q', '--detach');
    want('claim from a detached worktree', state(c, 'claim', '--todo', 'T-002', '--type', 'feat', '--slug', 'whisper', '--size', 'S', '--gate', 'build'), 0, '(remote)');

    writeFileSync(join(a, 'src', 'greet.mjs'), `${readFileSync(join(a, 'src', 'greet.mjs'), 'utf8')}// shout\n`);
    g(a, 'commit', '-q', '-am', 'feat(T-001): shout');
    want('pr before green', state(a, 'gate', '--set', 'pr'), 1, '[green]');
    want('test', state(a, 'test'), 0, 'Last green');
    want('pr', state(a, 'gate', '--set', 'pr'), 0, 'gate=pr');

    const comp = join(a, 'wiki', 'contracts', 'components', 'greet.md');
    const compText = readFileSync(comp, 'utf8');
    writeFileSync(comp, compText.replace('status: locked', 'status: draft'));
    want('build with a draft component page', state(a, 'gate', '--set', 'build'), 1, 'greet.md is draft');
    writeFileSync(comp, compText);

    g(b, 'commit', '-q', '--allow-empty', '-m', 'chore: someone else merged');
    g(b, 'push', '-q', 'origin', 'HEAD:main');
    want('back to build', state(a, 'gate', '--set', 'build'), 0, 'gate=build');
    want('pr while behind', state(a, 'gate', '--set', 'pr'), 1, '[rebase]');
    g(a, 'rebase', '-q', 'origin/main');
    want('test after rebase', state(a, 'test'), 0, 'Last green');
    want('pr after rebase', state(a, 'gate', '--set', 'pr'), 0, 'gate=pr');

    want('back to build again', state(a, 'gate', '--set', 'build'), 0);
    want('raise past plan-adversary', state(a, 'gate', '--set', 'pr-adversary', '--size', 'M'), 1, 'plan-adversary');
    want('raise', state(a, 'gate', '--set', 'plan-adversary', '--size', 'M'), 0, 'size=M');
    mkdirSync(join(a, 'plans'));
    const plan = join(a, 'plans', 'T-001.md');
    writeFileSync(plan, 'Budget: 50 lines\n');
    want('unreviewed plan', state(a, 'gate', '--set', 'build', '--plan', 'plans/T-001.md'), 1, 'not reviewed');
    writeFileSync(plan, 'Budget: 50 lines\nFindings: none\n');
    want('clean review', state(a, 'gate', '--set', 'build', '--plan', 'plans/T-001.md'), 0, 'gate=build');
    g(a, 'add', 'plans/T-001.md');
    g(a, 'commit', '-q', '-m', 'docs(T-001): plan');
    want('test before audit', state(a, 'test'), 0, 'Last green');
    want('pr-adversary', state(a, 'gate', '--set', 'pr-adversary'), 0, 'gate=pr-adversary');
    want('pr without reviewed commit', state(a, 'gate', '--set', 'pr', '--verdict', 'PASS'), 1, '--reviewed');
    const audited = sh(a, 'git', ['rev-parse', 'HEAD']).stdout.trim();
    writeFileSync(join(a, 'src', 'greet.mjs'), `${readFileSync(join(a, 'src', 'greet.mjs'), 'utf8')}// after audit\n`);
    g(a, 'commit', '-q', '-am', 'feat(T-001): change after audit');
    want('test after change', state(a, 'test'), 0, 'Last green');
    want('pr with a stale review', state(a, 'gate', '--set', 'pr', '--verdict', 'PASS', '--reviewed', audited), 1, 'rerun pr-adversary');
    const head = sh(a, 'git', ['rev-parse', 'HEAD']).stdout.trim();
    want('pr with the reviewed commit', state(a, 'gate', '--set', 'pr', '--verdict', 'PASS', '--reviewed', head), 0, 'gate=pr');
    writeFileSync(join(a, 'TODO.md'), readFileSync(join(a, 'TODO.md'), 'utf8').replace('- [ ] T-001', '- [x] T-001'));
    g(a, 'commit', '-q', '-am', 'docs(T-001): tick');
    want('pr re-run after a late commit', state(a, 'gate', '--set', 'pr', '--verdict', 'PASS', '--reviewed', head), 1, 'rerun pr-adversary');
    want('test after tick', state(a, 'test'), 0, 'Last green');
    const ticked = sh(a, 'git', ['rev-parse', 'HEAD']).stdout.trim();
    want('pr re-run in place', state(a, 'gate', '--set', 'pr', '--verdict', 'PASS', '--reviewed', ticked), 0, 'gate=pr');

    // CI re-checks the gates on the PR, where no STATE.md exists.
    const body = join(tmp, 'body.md');
    const ci = (sha, ref, base) => state(a, 'ci', '--head', sha, '--head-ref', ref, '--base', base, '--body-file', body);
    writeFileSync(body, 'No review here.\n');
    want('ci without a verdict', ci(ticked, 'feat/shout', 'main'), 1, '[verdict]');
    writeFileSync(body, `| HIGH | src/greet.mjs:1 | r | f | fixed |\r\nReviewed: ${head}\r\nVERDICT: PASS\r\n`);
    want('ci with a stale review', ci(ticked, 'feat/shout', 'main'), 1, 'differs from the PR head');
    writeFileSync(body, `Reviewed: ${ticked}\nVERDICT: BLOCKED\n\nReviewed: ${ticked.slice(0, 7)}\nVERDICT: PASS\n`);
    want('ci with the reviewed head', ci(ticked, 'feat/shout', 'main'), 0, 'PASS ci feat/shout -> main');
    want('ci from another branch name', ci(ticked, 'feat/yell', 'main'), 1, 'claimed as feat/shout');
    want('ci into another base', ci(ticked, 'feat/shout', 'next'), 1, 'task PRs target main');
    want('ci before the tick', ci(head, 'feat/shout', 'main'), 1, 'not ticked');
    want('ci on a push', state(a, 'ci'), 0, 'PASS ci');

    rmSync(join(a, 'STATE.md'));
    state(a, 'verify');
    const rebuilt = readFileSync(join(a, 'STATE.md'), 'utf8');
    if (!rebuilt.includes('Size: M') || !rebuilt.includes('Gate: plan-adversary')) errors.push(`lifecycle rebuild: want Size M at plan-adversary, got ${rebuilt}`);
    g(a, 'switch', '-q', 'main');
    want('verify on the integration branch', state(a, 'verify'), 0, 'PASS IDLE');
    const idle = readFileSync(join(a, 'STATE.md'), 'utf8');
    if (!idle.includes('Branch: main') || !idle.includes('Active TODO: —')) errors.push(`lifecycle idle: want an idle STATE.md on main, got ${idle}`);
    want('idle STATE.md is no task', state(a, 'gate', '--set', 'pr'), 2, 'no active task');
  } catch (e) {
    if (sandboxFailure(e)) sandboxed = true;
    else errors.push(`lifecycle: ${e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return sandboxed;
}

function selfTest() {
  const errors = [];
  const eq = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  const legal = (size, from, to, prev = size) => moveError(size, from, to, prev) === null;
  const moves = [ // [size, from, to, legal, prevSize?]
    ['S', null, 'build', true], ['S', null, 'grill-me', true], ['S', null, 'pr', false],
    ['M', null, 'build', false], ['L', null, 'build', false], ['M', null, 'plan-adversary', true],
    ['M', null, 'pr-adversary', false], ['S', 'build', 'pr', true], ['S', 'build', 'pr-adversary', true],
    ['S', 'sync-wiki', 'build', true], ['S', 'sync-wiki', 'pr', false], ['S', 'build', 'build', false],
    ['S', 'build', 'sync-wiki', true], ['S', 'pr', 'build', true], ['M', 'grill-me', 'plan-adversary', true],
    ['M', 'sync-wiki', 'build', false], ['M', 'plan-adversary', 'build', true], ['M', 'build', 'pr', false],
    ['L', 'build', 'pr-adversary', true], ['L', 'pr-adversary', 'pr', true], ['M', 'build', 'nowhere', false],
    ['M', 'build', 'pr-adversary', false, 'S'], ['M', 'build', 'plan-adversary', true, 'S'],
    ['M', 'pr-adversary', 'pr', false, 'S'], ['M', 'pr-adversary', 'build', true],
  ];
  for (const [size, from, to, want, prev] of moves) eq(`move [${prev ?? size}->${size}] ${from} -> ${to}`, legal(size, from, to, prev), want);

  const row = (severity, status) => `| ${severity} | src/a.js:1 | rule | fix | ${status} |`;
  const header = '| severity | file:line | rule | fix | status |\n| --- | --- | --- | --- | --- |';
  const blockers = (...rows) => planBlockers([header, ...rows].join('\n')).length;
  eq('empty table', blockers(), 0);
  eq('CRITICAL open', blockers(row('CRITICAL', 'open')), 1);
  eq('CRITICAL waived', blockers(row('CRITICAL', 'waived-by:ana')), 1);
  eq('CRITICAL fixed', blockers(row('CRITICAL', 'fixed')), 0);
  eq('HIGH open', blockers(row('HIGH', 'open')), 1);
  eq('HIGH bold', blockers(row('**HIGH**', '`open`')), 1);
  eq('HIGH no trailing pipe', blockers('| HIGH | src/a.js:1 | rule | fix | open'), 1);
  eq('HIGH waived without a name', blockers(row('HIGH', 'waived-by:')), 1);
  eq('HIGH waived', blockers(row('HIGH', 'waived-by:ana')), 0);
  eq('HIGH fixed', blockers(row('high', 'Fixed')), 0);
  eq('MEDIUM open', blockers(row('MEDIUM', 'open')), 0);
  eq('mixed rows', blockers(row('HIGH', 'fixed'), row('CRITICAL', 'open'), row('HIGH', 'open')), 2);
  eq('reviewed: empty table', planReviewed(header), false);
  eq('reviewed: clean review', planReviewed(`${header}\n\nFindings: none\n`), true);
  eq('reviewed: template prose', planReviewed('A clean review adds the line `Findings: none`.'), false);
  eq('reviewed: rows', planReviewed([header, row('LOW', 'open')].join('\n')), true);
  eq('todo rows', todoRows('# x\n- [x] T-001 | a | [S] | chore | — | — | c\n- [ ] T-002 | b-c | [M] | feat | wiki/features/b.md | FR-001 | c'),
    [{ id: 'T-001', done: true, slug: 'a', type: 'chore', page: '—', ids: '—', after: [], raw: 'T-001 | a | [S] | chore | — | — | c' },
      { id: 'T-002', done: false, slug: 'b-c', type: 'feat', page: 'wiki/features/b.md', ids: 'FR-001', after: [], raw: 'T-002 | b-c | [M] | feat | wiki/features/b.md | FR-001 | c' }]);
  const deps = todoRows('- [x] T-001 | a | [S] | chore | — | — | c\n- [ ] T-002 | b | [S] | feat | — | — | c\n- [ ] T-003 | d | [M] | feat | — | — | c | after: T-001, T-002, T-009');
  eq('todo after', deps[2].after, ['T-001', 'T-002', 'T-009']);
  eq('waiting on unticked and unknown', waitingOn(deps[2], deps), ['T-002', 'T-009']);
  eq('spec: no page', specError('—', undefined), null);
  eq('spec: locked', specError('wiki/features/b.md', 'locked'), null);
  eq('spec: legacy', specError('wiki/features/b.md', 'legacy'), null);
  eq('spec: draft', typeof specError('wiki/features/b.md', 'draft'), 'string');
  eq('spec: missing', typeof specError('wiki/features/b.md', undefined), 'string');
  eq('docs-only: empty branch', docsOnly([]), true);
  eq('docs-only: init files', docsOnly(['.gitignore', '.env.example', 'wiki/contracts/ui/mockups/a.html', 'AGENTS.md']), true);
  eq('docs-only: code', docsOnly(['README.md', 'src/a.mjs']), false);
  eq('default plan', [defaultPlan('T-004', 'S'), defaultPlan('T-004', 'M')], ['—', 'plans/T-004.md']);
  eq('budget', planBudget('Rung: 3\nBudget: 120 lines\n'), 120);
  eq('budget placeholder', planBudget('Budget: <n> lines\n'), null);
  eq('budget missing', planBudget('no budget here'), null);
  eq('size: claim only', taskSize(['chore(T-001): claim a [S] gate=build'], 'T-001', 'S'), 'S');
  eq('size: raised', taskSize(['chore(T-001): resize [L]', 'chore(T-002): resize [M]'], 'T-001', 'M'), 'L');
  const pushes = 'refs/heads/feat/x 1 refs/heads/feat/x 0\nrefs/heads/main 1 refs/heads/main 0\n(delete) 0 refs/heads/develop 1\n';
  eq('pre-push protected', pushedProtected(pushes, ['develop', 'main']), ['refs/heads/main', 'refs/heads/develop']);
  eq('pre-push task branch', pushedProtected('refs/heads/a 1 refs/heads/main-fix 0', ['main']), []);
  eq('pre-push no input', pushedProtected('', ['main']), []);
  eq('verdict: last wins', prVerdict('Reviewed: abc1234\nVERDICT: PASS\nReviewed: def5678\nVERDICT: BLOCKED'), { reviewed: 'def5678', verdict: 'BLOCKED' });
  eq('verdict: missing', prVerdict(''), { reviewed: null, verdict: null });

  let skipped = false;
  if (!errors.length) skipped = lifecycleTest(errors);
  for (const e of errors) console.log(`FAIL [self-test] ${e}`);
  if (errors.length) process.exit(1);
  // A skipped lifecycle is not a pass: claim lock, rebase rule, reviewed-sha binding and STATE.md rebuild did not run.
  if (skipped) {
    console.log('BLOCKED [sandbox] SELF_TEST_PARTIAL rules passed, lifecycle not run: Git transport is blocked; rerun with wider permissions');
    process.exit(2);
  }
  console.log('SELF_TEST_OK');
  process.exit(0);
}

function parseArgs(argv) {
  const o = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) rest.push(argv[i]);
    else o[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return { o, rest };
}

const [cmd, ...argv] = process.argv.slice(2);
try {
  const { o } = parseArgs(argv);
  if (cmd === '--self-test') selfTest();
  else if (cmd === 'next') next(o);
  else if (cmd === 'claim') claim(o);
  else if (cmd === 'gate') gate(o);
  else if (cmd === 'test') test(argv);
  else if (cmd === 'verify') verify();
  else if (cmd === 'ci') ci(o);
  else if (cmd === 'pre-push') prePush();
  else {
    fail('usage', 'state.mjs next | claim | gate | test | verify | ci | pre-push | --self-test');
    finish();
  }
} catch (e) {
  if (sandboxFailure(e)) blocked('sandbox', SANDBOX_HINT);
  else blocked('git', String(e.stderr || e.message).trim().split(/\r?\n/)[0]);
  finish();
}
