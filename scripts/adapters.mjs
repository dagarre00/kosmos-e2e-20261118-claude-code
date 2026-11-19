#!/usr/bin/env node
// adapters.mjs: keeps the harness adapters' thin pointers in step with the canonical skills and agents.
// Exit 0 PASS, 1 FAIL. Usage: node scripts/adapters.mjs [--write] | --self-test (see scripts/README.md)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// One entry per adapter: where its pointers live and what their body says. An adapter whose
// directory does not exist is skipped, so deleting `.dsh/` (or `.claude/`) opts out of it.
const ADAPTERS = [
  {
    dir: '.claude',
    skill: (n) => `Read \`.agents/skills/${n}/SKILL.md\` and follow it exactly.`,
    agent: (n) => `Read \`.agents/agents/${n}.md\` and follow its body exactly.`,
  },
  {
    dir: '.dsh',
    skill: (n) => `The canonical skill is \`.agents/skills/${n}/SKILL.md\` from the repository root (\`../../../.agents/skills/${n}/SKILL.md\` from this skill's base directory). Read it and follow it exactly. Then read \`.dsh/skills/dsh-adapter/SKILL.md\` from the repository root (\`../dsh-adapter/SKILL.md\` from this skill's base directory) and apply its rules.`,
    agent: null, // DSH has no project agent folder; see .dsh/skills/dsh-adapter
  },
];

const read = (p) => readFileSync(p, 'utf8');
const dirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
const mdFiles = (p) => (existsSync(p) ? readdirSync(p).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort() : []);

// Frontmatter as ordered [key, value] pairs plus the body; null when the file has none.
function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fm = m[1].split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  });
  return { fm, body: m[2].trim() };
}

// The pointer a canonical file should have in one adapter. Keys other than name and description belong to
// the adapter (such as `context: fork` or `tools:`) and are kept from the existing pointer.
function render(canonical, existing, body) {
  const get = (fm, k) => fm.find(([key]) => key === k)?.[1];
  const extra = (existing?.fm ?? []).filter(([k]) => k !== 'name' && k !== 'description');
  const fm = [['name', get(canonical.fm, 'name')], ['description', get(canonical.fm, 'description')], ...extra];
  return `---\n${fm.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}\n`;
}

// Every pointer that is missing, stale or orphaned, with the content it should have (null: delete it).
function plan(root) {
  const out = [];
  const kinds = [
    { canon: '.agents/skills', list: dirs, file: (n) => `${n}/SKILL.md`, body: (a) => a.skill, sub: 'skills' },
    { canon: '.agents/agents', list: mdFiles, file: (n) => `${n}.md`, body: (a) => a.agent, sub: 'agents' },
  ];
  for (const k of kinds) {
    const names = k.list(join(root, k.canon));
    for (const n of names) {
      const c = parse(read(join(root, k.canon, k.file(n))));
      const name = c?.fm.find(([key]) => key === 'name')?.[1];
      if (!c || name !== n) out.push({ path: `${k.canon}/${k.file(n)}`, problem: `canonical frontmatter needs name: ${n}`, content: undefined });
    }
    for (const a of ADAPTERS) {
      const make = k.body(a);
      const base = `${a.dir}/${k.sub}`;
      if (!make || !existsSync(join(root, a.dir))) continue;
      for (const n of names) {
        const c = parse(read(join(root, k.canon, k.file(n))));
        if (!c) continue;
        const path = `${base}/${k.file(n)}`;
        const full = join(root, path);
        const now = existsSync(full) ? read(full).replace(/\r\n/g, '\n') : null;
        const want = render(c, now === null ? null : parse(now), make(n));
        if (now === null) out.push({ path, problem: 'missing', content: want });
        else if (now !== want) out.push({ path, problem: 'stale', content: want });
      }
      // A pointer whose canonical file is gone is an orphan; adapter-only files (no pointer body) are left alone.
      for (const n of k.list(join(root, base))) {
        if (names.includes(n)) continue;
        const path = `${base}/${k.file(n)}`;
        const doc = existsSync(join(root, path)) ? parse(read(join(root, path))) : null;
        if (doc && doc.body === make(n)) out.push({ path, problem: 'orphan (no canonical file)', content: null });
      }
    }
  }
  return out;
}

function apply(root, items) {
  for (const { path, content } of items) {
    const full = join(root, path);
    if (content === null) rmSync(path.endsWith('/SKILL.md') ? dirname(full) : full, { recursive: true, force: true });
    else if (content !== undefined) {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
}

function selfTest() {
  const errors = [];
  const tmp = mkdtempSync(join(tmpdir(), 'adapters-test-'));
  try {
    for (const d of ['.agents', '.claude', '.dsh']) cpSync(join(ROOT, d), join(tmp, d), { recursive: true });
    const problems = () => plan(tmp).map((p) => `${p.path} ${p.problem}`);
    if (problems().length) errors.push(`repository adapters are not clean: ${problems().join('; ')}`);

    const canon = join(tmp, '.agents/skills/next-todo/SKILL.md');
    writeFileSync(canon, read(canon).replace(/^description: .*$/m, 'description: Changed.'));
    const stale = problems();
    if (!stale.includes('.claude/skills/next-todo/SKILL.md stale') || !stale.includes('.dsh/skills/next-todo/SKILL.md stale')) {
      errors.push(`changed description: want both pointers stale, got ${stale.join('; ')}`);
    }
    apply(tmp, plan(tmp));
    if (problems().length) errors.push(`--write left problems: ${problems().join('; ')}`);
    if (!read(join(tmp, '.claude/skills/pr-adversary/SKILL.md')).includes('context: fork')) errors.push('--write dropped an adapter-only key');

    mkdirSync(join(tmp, '.agents/skills/new-skill'));
    writeFileSync(join(tmp, '.agents/skills/new-skill/SKILL.md'), '---\nname: new-skill\ndescription: New.\n---\n# new\n');
    rmSync(join(tmp, '.agents/skills/regen-drill'), { recursive: true });
    const moved = problems();
    for (const want of ['.claude/skills/new-skill/SKILL.md missing', '.dsh/skills/new-skill/SKILL.md missing',
      '.claude/skills/regen-drill/SKILL.md orphan (no canonical file)', '.dsh/skills/regen-drill/SKILL.md orphan (no canonical file)']) {
      if (!moved.includes(want)) errors.push(`want "${want}", got ${moved.join('; ')}`);
    }
    if (moved.some((p) => p.includes('dsh-adapter'))) errors.push('adapter-only skill reported');
    apply(tmp, plan(tmp));
    if (problems().length) errors.push(`--write left problems: ${problems().join('; ')}`);
    if (existsSync(join(tmp, '.claude/skills/regen-drill'))) errors.push('orphan pointer not deleted');
    if (!existsSync(join(tmp, '.dsh/skills/dsh-adapter/SKILL.md'))) errors.push('adapter-only skill deleted');

    writeFileSync(join(tmp, '.agents/skills/new-skill/SKILL.md'), '---\nname: other\ndescription: New.\n---\n');
    if (!problems().some((p) => p.includes('needs name: new-skill'))) errors.push('mismatched canonical name not reported');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const e of errors) console.log(`FAIL [self-test] ${e}`);
  if (!errors.length) console.log('SELF_TEST_OK');
  process.exit(errors.length ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.some((a) => !['--write', '--self-test'].includes(a))) {
  console.log('FAIL [usage] adapters.mjs [--write] | --self-test');
  process.exit(1);
}
if (args.includes('--self-test')) selfTest();
const items = plan(ROOT);
if (args.includes('--write')) {
  apply(ROOT, items);
  for (const i of items) console.log(`${i.content === undefined ? 'FAIL [adapters]' : 'WROTE'} ${i.path} ${i.problem}`);
  const left = plan(ROOT);
  process.exit(left.length ? 1 : (console.log('ADAPTERS_OK'), 0));
}
for (const i of items) console.log(`FAIL [adapters] ${i.path} ${i.problem}${i.content === undefined ? '' : ' (run node scripts/adapters.mjs --write)'}`);
if (!items.length) console.log('ADAPTERS_OK');
process.exit(items.length ? 1 : 0);
