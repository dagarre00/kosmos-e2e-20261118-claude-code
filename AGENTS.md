# Agent instructions

## Workflow

**Law.** `wiki/` is the spec; `src/` and `test/` are a build of it. The test: deleted, they could be rebuilt from `wiki/` alone and pass the same tests. Anything observable the code decides that the wiki does not state (an interface, output, message, limit, default, error case or stored data) → stop and emit `WIKI_GAP: <detail>`; internal choices (names, private helpers, log text) are the builder's. `status: legacy` marks code not yet regenerable.

**Context.** Read `STATE.md` first; it lists the 2–4 files to read next. Never edit it; only `node scripts/state.mjs` writes it. Open `wiki/00-index.md` only to locate a page. Never bulk-read `wiki/` or `src/` and `test/`; prefer line ranges and `git diff --stat`. One TODO per session; a `batch-todos` coordinator claims for its workers and builds nothing itself. Output terse: no preamble, recap or restated code.

**Scope.** Build only what the task's acceptance criteria require. No unrequested features, options, abstractions or refactors; a problem outside the task becomes a new `TODO.md` line. Stop at the first rung that works: 1 skip it · 2 reuse repo code · 3 stdlib · 4 platform feature · 5 existing dependency · 6 one line · 7 smallest working code, marked `ponytail: <ceiling> | <upgrade path>` in a comment. New dependencies need human approval. Never cut: input validation at trust boundaries, error and data-loss handling, security, accessibility.

**Git.** Check `git status` first; never discard, stash or reset user changes. Start work with the `next-todo` skill, which claims `<type>/<slug>`. Never commit to `main`; the `.githooks/pre-push` hook refuses the push. Small Conventional Commits citing `T-XXX`. `--force-with-lease` only on your own task branch. Never commit secrets.

**Shared repo.** Others work here in parallel; the pushed task branch is the lock. Never work on a branch you did not claim, and never take a `CLAIMED` task. `STATE.md` is local to your clone. Rebase conflicts: in `TODO.md`, `wiki/00-index.md` and folder index pages (`wiki/**/00-*.md`, such as `00-modules.md`) keep both sides' lines; an ID you added on this branch (`T-`, `US-`, `FR-`, `NFR-`) that now exists on `origin/main` → renumber yours everywhere on the branch; two sides changing the same wiki statement → `BLOCKED: spec conflict <page>`, the humans decide; code conflicts follow the merged wiki.

**Gates.** Move with `node scripts/state.mjs gate --set <gate>`; it refuses an illegal or unready move and names what is missing in its `FAIL`/`BLOCKED` lines. CI (`state.mjs ci`) re-checks the same on the PR. No locked spec → `grill-me` first. A new feature's spec lands in its own `docs` task, so its merged PR is the human review of the wiki before any code; the build task waits on it with `after:` in `TODO.md`. `[S]`: `sync-wiki` if behavior changes → `build` → `pr`. `[M]`/`[L]`, or anything touching auth, secrets, payments, migrations or a trust boundary: `sync-wiki` → `plan-adversary` → `build` → `pr-adversary` → `pr`. Adversaries run in a fresh context: the harness's own subagent or fork, else a handoff to a new session. Quote the command and its result line for every pass you report; `PASS (docs-only)`, `SELF_TEST_PARTIAL` or any skipped part is never "all pass". Finish: a code task flips its component pages to `implementation: done` → tick `TODO.md` → `git fetch`, rebase onto `origin/main` → `node scripts/state.mjs test` → `[S]` `gate --set pr`; `[M]`/`[L]` `gate --set pr-adversary`, run `pr-adversary` until `PASS`, `gate --set pr --verdict PASS --reviewed <sha it printed>` → open the PR.

**UI.** A new or changed screen gets a `ui-mockup` before its component pages; show it with the harness's own HTML viewer, else `node scripts/preview.mjs <name>` (add `--serve` in a remote session). Sign-off is a pause.

**Audit.** Run `repo-audit` on a schedule (weekly, before a release) or on request; any PR can be audited standalone with `pr-adversary <PR number or branch>`.

**Pause only for:** `BLOCKED`, `WIKI_GAP`, `HUMAN_TODO`, a `HIGH` finding, a new dependency, UI sign-off.

**Inventory.** New account, service, env var or secret → update `DEPLOY_INVENTORY.md` and `.env.example` in the same commit. Human-only step → add `H-XXX` there and emit `HUMAN_TODO: <detail>`.

**Handoff.** Copy `handoffs/_template.md` to `handoffs/active-handoff.md`, fill it, and output `Read and execute handoffs/active-handoff.md`.
