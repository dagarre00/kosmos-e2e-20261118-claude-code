# scripts

Four zero-dependency Node ≥ 18 scripts. Exit codes: `0` PASS, `1` FAIL, `2` BLOCKED (a prerequisite is missing). Findings print one per line: `FAIL [check] file:line message`.

The scripts capture child output through files, not pipes, so they run inside a sandboxed harness. Git transport (`fetch`, `push`, `clone`) and a `verify_cmd` that spawns children may need wider permissions; commands that only commit, diff or read stay sandboxed.

`state.mjs` and `verify-wiki.mjs` read project settings from the frontmatter of `wiki/infra/00-stack.md`: `source_roots: [a, b]`, `integration: <branch>`, `default: <branch>`, `install_cmd: <shell command>` (optional, CI only), `verify_cmd: <shell command>`, `test_glob: [git pathspec globs]`. A missing, empty or double-brace value is unresolved and reports `BLOCKED [config]`.

## state.mjs

The only writer of `STATE.md`. Gate order: `grill-me → sync-wiki → plan-adversary → build → pr-adversary → pr`. Backward moves are allowed (forward guards re-run on the way back up); raising `[S]` to `[M]`/`[L]` at or past `build` must go through `plan-adversary`. Required gates: `[S]` `build`, `pr`; `[M]`/`[L]` `plan-adversary`, `build`, `pr-adversary`, `pr`. Others may be skipped.

`STATE.md` is gitignored and local to one clone. What other people see is the pushed task branch: it is the lock on a task.

```
node scripts/state.mjs next [--limit <n>]
```

Fetches, then lists the unticked lines of `TODO.md` as it is on `origin/<integration>`, in order, up to the `--limit`-th free one (default 3): `FREE <line>`, `WAITING T-XXX <type>/<slug> (after T-YYY)` while a task in its `after:` column is not ticked there (an unknown ID never counts as ticked), or `CLAIMED T-XXX <type>/<slug> (<author>, <age>)` when that branch exists locally or on `origin`. `NONE` when nothing is free. Releasing an abandoned claim is a human decision: delete its branch on `origin`.

```
node scripts/state.mjs claim --todo T-XXX --type <type> --slug <slug> --size <S|M|L> --gate <gate>
```

Exit `2` unless the tree is clean, `T-XXX` is exactly one unticked line of `TODO.md` on `origin/<integration>` and `<type>/<slug>` exists nowhere, and every `after:` task is ticked. `<type>` and `<slug>` must be the ones on that line (`FAIL [usage]` otherwise), so two people can never hold the same task under different branch names. Fetches, branches from `origin/<integration>` (local if there is no remote), makes the empty commit `chore(T-XXX): claim <slug> [<size>] gate=<gate>` and pushes. A lost push race deletes the local branch and exits `2`; any other push failure, or no `origin`, continues with `Claim: local-only` and a `WARN` line: nobody else can see that lock. `--gate build` is legal only for `[S]`, and only when the line's wiki page and every component page whose `implements` names one of the line's IDs are `locked` or `legacy` on `origin/<integration>` (`FAIL [spec]`). An `[M]`/`[L]` claim records `Plan: plans/T-XXX.md`. A detached `HEAD` is fine (a fresh `git worktree add --detach` for a batch worker); a lost race returns to the starting commit. A successful claim enables the push guard in this clone (`git config core.hooksPath .githooks`, `INFO hooks`) unless `core.hooksPath` is already set or hooks are already installed (`WARN hooks`).

```
node scripts/state.mjs gate --set <gate> [--read a,b] [--plan path] [--next "text"] [--size M|L] [--verdict PASS --reviewed <sha>]
```

`--read` takes 2–4 paths. A finishing gate (`pr-adversary`, `pr`) may be set again while already there: every guard re-runs, so a commit made after it (such as the `TODO.md` tick) needs `test` first, and on `[M]`/`[L]` `pr` a review of the new `HEAD`. Any other move to the current gate is `FAIL [gate] already at <gate>`. Size may only go up; a raise is recorded as the empty commit `chore(T-XXX): resize [<size>]`. `verify-wiki.mjs` output is shown only when it does not exit `0`. Guards:

| Into | Requires |
| --- | --- |
| `plan-adversary`, `build` | if the branch touches `wiki/`, `verify-wiki.mjs` exits `0` |
| `build` | the task's linked wiki page (its `TODO.md` line) and every component page whose `implements` names one of the line's IDs are `locked` or `legacy`, else `FAIL [spec]` |
| `build` on `[M]`/`[L]` | the plan exists, has a `Budget: <n>` line, no `CRITICAL` row that is not `fixed`, no `HIGH` row that is neither `fixed` nor `waived-by:<name>`, and is reviewed: it has at least one findings row, or the line `Findings: none` after a clean review |
| `pr-adversary`, `pr` | after a best-effort fetch the branch contains the tip of `origin/<integration>` (else `FAIL [rebase]`), `verify` passes and `verify-wiki.mjs --check-env --check-debt --check-coverage` exits `0` |
| `pr` on `[M]`/`[L]` | `--verdict PASS` and `--reviewed <sha>`: the commit `pr-adversary` printed, with no diff to `HEAD`, so any change after the audit needs a new one |

```
node scripts/state.mjs test
```

Runs `verify_cmd` in full; takes no arguments. Docs-only is judged on the whole branch diff against the merge-base, not on the last commit. A branch that touches only `*.md` files, files under `wiki/` (UI mockups), `.gitignore`, `.gitattributes`, `.env.example` and `scripts/preview.mjs`, or nothing yet, prints `PASS (docs-only)` without running. On pass with a clean tree it writes `Last green: <HEAD sha>`; with a dirty tree it prints `PASS | UNSTAMPED (commit first)`. No `verify_cmd` → `BLOCKED [test] VERIFY_CMD_UNRESOLVED`.

```
node scripts/state.mjs verify
```

`BLOCKED [git]` on a detached `HEAD`; `PASS IDLE` with no active task, after rewriting `STATE.md` as idle for this branch (`Active TODO: —`, `Next action: run the next-todo skill`), so a merged task's gate and green do not read as current. Otherwise `PASS STATE_OK` only if the tree is clean, `Last green` has no diff to `HEAD`, and changed lines (added + deleted) under the source roots since the merge-base, excluding `test_glob`, are within budget: 150 for `[S]`, the plan's `Budget` × 1.25 otherwise. Over budget → `FAIL [budget]`: cut code, or raise the size or the plan's budget.

A `STATE.md` that is missing, or written for another branch, is rebuilt from the claim commit at its initial gate (`Plan: plans/T-XXX.md` for `[M]`/`[L]`), with the largest size among the claim and any `resize` commits; a task whose size was raised restarts no later than `plan-adversary`.

```
node scripts/state.mjs ci [--head <sha> --head-ref <branch> --base <branch> --body-file <path>]
```

The gates for CI, where no `STATE.md` exists; `.github/workflows/workflow.yml` runs it on every push and PR with full history. `integration` unresolved (the template itself) → `PASS (template)`. Otherwise: `verify-wiki.mjs --check-env --check-debt --check-coverage`, then, unless the diff from the merge-base is docs-only, `install_cmd` (if set) and `verify_cmd`. On a pull request (the flags, else `GITHUB_EVENT_PATH`) it also checks:

| Check | Rule |
| --- | --- |
| `pr` | the base is `integration`; a PR from `integration` into `default` is a release and skips the rest |
| `claim` | the branch has a claim commit and is named `<type>/<slug>` as its `TODO.md` line on the base; no claim commit while the base is not initialized is the `workflow-init` PR and skips the rest |
| `todo` | the task's line is ticked in the PR's `TODO.md` |
| `plan`, `budget` | as the `build` and finishing gates, with the size from the claim and `resize` commits and the plan at `plans/T-XXX.md` |
| `verdict` | `[M]`/`[L]`: the PR body's last `VERDICT:` line is `PASS` and its last `Reviewed: <sha>` has no diff to the PR head |

```
node scripts/state.mjs pre-push
```

The Git `pre-push` hook (`.githooks/pre-push`). Reads the refs being pushed from stdin and fails with `FAIL [push]` for any update or delete of the `integration` or `default` branch; prints nothing on pass. Unresolved config protects nothing. A human releasing on purpose uses `git push --no-verify`.

```
node scripts/state.mjs --self-test
```

Asserts the gate table, the plan and `TODO.md` parsers, `after:` and the spec rule against inline cases, then runs one task end to end in a temporary origin with three clones: the claim lock, `WAITING`, a claim from a detached `HEAD`, the gates, the rebase rule, a size raise, a verdict bound to the reviewed commit, a finishing gate re-run after a late commit, `ci` on the PR (missing, stale and bound verdicts, wrong branch name or base, an unticked line, a push), a lost `STATE.md` and the idle `STATE.md` on the integration branch. It also asserts the size, pre-push and PR-body parsers. Needs `git` and takes about ten seconds. When the sandbox blocks Git transport the lifecycle part cannot run: it prints `BLOCKED [sandbox] SELF_TEST_PARTIAL …` and exits `2`, never `SELF_TEST_OK`; rerun with wider permissions for the full test.

## verify-wiki.mjs

```
node scripts/verify-wiki.mjs [--check-env] [--check-debt] [--check-coverage]
node scripts/verify-wiki.mjs --self-test
```

Prints `WIKI_OK` on pass. Skips `_template.md` files and `mockups/`. Always runs:

| Check | Rule |
| --- | --- |
| `size` | page ≤ 500 words (≤ 350 under `contracts/components/`), not counting frontmatter, code fences and tables; `00-index.md` ≤ 50 lines |
| `links` | `[[folder/page]]` is an exact path under `wiki/` without `.md`; every link resolves (text inside inline code, of any backtick run, is literal and not a link); a `locked` page links no `draft` page except `00-*.md` folder indexes; every page is reachable from `00-index.md` |
| `layering` | `product` 0, `domain` 1, `features` 2, `contracts` 3, `infra` 4; links go to the same or a lower number; `00-index.md` and `decisions/` are exempt |
| `frontmatter` | flat `key: value` lines and inline lists `[a, b]`; `status` is `draft`, `locked`, `legacy` or `retired`; component pages also need `target`, `implements`, `tests`, `implementation` (`pending`, `done`); legacy ones need `status` and `target`; `00-*.md` and retired pages need `status`; a UI contract (`contracts/ui/`, not `00-*`) needs `mockup: mockups/<name>.html` naming an existing file, and when locked `approved-by: <human> <yyyy-mm-dd>` |
| `precision` | `locked` pages may not contain `TBD`, `TODO`, `???`, `WIKI_GAP`, `etc.`, `and so on`, `as appropriate`, `somehow` outside code fences; on `draft` pages `WIKI_GAP` prints a non-failing `DRAFT_GAP` |
| `trace` | IDs are headings (`### US-001 …`, `### FR-001 …`, `### NFR-001 …`), three digits, unique. On `locked` pages: `US-` has `Given`, `When`, `Then`; `FR-` is in a component's `implements`; `NFR-` has a `Verify:` line. With `implementation: done`: `target` and every `tests` path exist, `tests` is non-empty, and every `implements` ID appears as text in a tests file |

Flags:

- `--check-env` (`env`): names in `.env.example` (`NAME=`), in `DEPLOY_INVENTORY.md` (table rows whose first cell is a backticked name) and in env reads under the source roots must match. Fixed patterns cover JS/TS, Python, Go, Ruby, Rust, PHP, Java/Kotlin and C#. Ignored: `NODE_ENV`, `CI`, `PATH`, `HOME`, `TZ`, `MODE`, `DEV`, `PROD`, `SSR`, `BASE_URL`. A dynamic read is `BLOCKED [env] ENV_UNRESOLVED file:line` unless its line carries the comment `env-ignore`.
- `--check-debt` (`debt`): every `ponytail:` marker under the source roots has `<ceiling> | <upgrade path>`.
- `--check-coverage` (`coverage`): every file under the source roots sits under a component page's `target` or `tests` path, or a path in the `00-modules.md` table (first column), else `FAIL [coverage] <file>`. On a branch: added files need a locked component page; modified files need a locked component page or a `legacy` one with a non-empty `## Specified` section, else `FAIL [coverage] <file> changed without spec`. A configured integration branch with no merge-base (a shallow CI clone) is `BLOCKED [coverage]`: fetch full history. Prints `COVERAGE specified=<n>% legacy=<n>% uncovered=<n>`, counted by file.

`--self-test` runs every check against `scripts/fixtures/pass/` (must be clean) and `scripts/fixtures/fail/` (must trip each check exactly once). It then commits the pass fixture to a temporary local repository and checks the branch rule of `coverage`: a file added or changed under a `00-modules.md` path fails, a change under a locked page passes (local `git` only, no transport).

## adapters.mjs

```
node scripts/adapters.mjs [--write]
node scripts/adapters.mjs --self-test
```

Skills and agent roles live once, in `.agents/skills/<name>/SKILL.md` and `.agents/agents/<name>.md`; each harness adapter (`.claude/` skills and agents, `.dsh/` skills) holds a thin pointer to them. An adapter whose directory is missing is skipped. A pointer's `name`, `description` and body are generated from the canonical file; its other frontmatter keys belong to that adapter (such as `context: fork`, `agent:`, `tools:`, `model:`) and are kept. Without flags it prints `FAIL [adapters] <path> missing | stale | orphan (no canonical file)` or `ADAPTERS_OK`; a canonical file whose `name` differs from its directory or file name also fails. `--write` creates, rewrites and deletes pointers to match (adapter-only files, such as `.dsh/skills/dsh-adapter`, are never touched) and exits `0` when nothing is left.

`--self-test` copies the three directories to a temporary one and checks: they are clean, a changed description makes both pointers stale, `--write` keeps adapter-only keys, a new skill is missing and a deleted one orphaned in both adapters, and a mismatched name is reported.

## preview.mjs

```
node scripts/preview.mjs <name> [--serve [--port <n>]]
node scripts/preview.mjs --self-test
```

Shows `wiki/contracts/ui/mockups/<name>.html` to the human from any harness, for the `ui-mockup` sign-off. `<name>` is lowercase-kebab, which also rules out path traversal. Without flags it opens the file in the OS default browser and prints `PREVIEW file:///…`; with no opener (headless, container) `BLOCKED [open]` and the URL to open by hand. `--serve` serves that one file on `127.0.0.1` (port `0` picks a free one), prints `PREVIEW http://127.0.0.1:<port>/` and runs until stopped; every other path is `404`, and each request rereads the file, so a reload shows edits. Use it from remote, container or cloud sessions with port forwarding. A harness with its own HTML viewer (preview pane, IDE webview, artifact page) can open the file directly instead.

`--self-test` checks the name rule and that the server returns the file at `/` and `404` elsewhere.
