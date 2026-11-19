---
name: repo-audit
description: Periodic read-only sweep of the whole repository for spec drift, debt and stale state, ending in ready-to-append TODO.md lines. Use on a schedule (weekly, before a release) or on "audit the repo", "repo review", "health check".
---
# repo-audit

Fresh, read-only context: a fresh subagent or fork of the harness (the `adversary` role when it exposes custom agents), else a handoff to a new session. Work on a clean checkout of `origin/<integration>`, detached (a temporary `git worktree add --detach`, removed at the end); never switch a task branch. Edit nothing. Never run `state.mjs verify`, `test` or `gate` here: they need a task branch.

1. Run and record each exit code and finding:
   - `node scripts/verify-wiki.mjs --check-env --check-debt --check-coverage` (keep the `COVERAGE` line)
   - every `--self-test` in `scripts/`, and `node scripts/adapters.mjs` (never `--write`)
   - `verify_cmd` from `wiki/infra/00-stack.md`
   - `node scripts/state.mjs next --limit 1000`
2. Drift: for up to five component pages, oldest last-commit first (`git log -1 --format=%cs -- <page>`), read the page, then its `target`. Every behavior, constant or message the code has and the page does not state is `UNSPECIFIED`, with the severity rule of `pr-adversary` step 3; anything the page states and the code lacks is `MISSING`.
3. Debt and state:
   - each `ponytail:` marker whose ceiling the code or data now reaches
   - each locked `NFR-`: run its `Verify:` command verbatim if it is a read-only command (a non-zero exit is a `MEDIUM` finding against that line, even when another spelling passes), else list it as manual
   - `legacy` pages and `uncovered` files that have no `TODO.md` line yet
   - `CLAIMED` tasks older than 7 days, and `open` `H-XXX` rows in `DEPLOY_INVENTORY.md`
   - screens under the source roots with no `wiki/contracts/ui/` page carrying `approved-by`
4. Suggest one `regen-drill` target: the component page with the most changes since it was locked.

Output ≤ 300 words: findings as `| severity | file:line | rule | fix |` rows, then the `COVERAGE` line, then the proposed `TODO.md` lines in the header format, numbered `T-NEW-1`, `T-NEW-2`, … (the human or the task that appends them gives real numbers). The session that started the audit appends them to `TODO.md` in a `docs` task, or hands the list to the human; the audit is not closed until one of those happened. Stale claims and `H-XXX` go to the human, not to `TODO.md`. A clean sweep is the single line `Audit: clean`.
