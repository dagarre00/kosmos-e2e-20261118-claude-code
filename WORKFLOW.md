# How this repository works

This is a guide for the humans on the project. Agents follow `AGENTS.md` and the skills in `.agents/skills/`. This page explains what they do and what they need from you.

## The idea

`wiki/` is the specification and the source code is a build of it. Delete the code, and an agent holding only the wiki should be able to rebuild it and pass the same tests. Three things follow from that:

- Behavior changes start in the wiki: interfaces, outputs, messages, limits, defaults, error cases and stored data. Code that does something observable the wiki does not state is a defect, even when it works.
- A wiki page moves from `draft` to `locked`. Code is built only against `locked` pages. `legacy` marks existing code that has not been specified yet.
- `regen-drill` proves it: it deletes one component and rebuilds it from its page in a temporary worktree.

## Where things live

| Path | What it is | Who writes it |
| --- | --- | --- |
| `wiki/` | The spec: product, domain, features, contracts, infra, decisions | Agents, reviewed by you in PRs |
| `TODO.md` | One flat, ordered backlog; each line is a task with a size, a linked page and an acceptance criterion | Agents append; each task ticks its own line |
| `plans/T-XXX.md` | The plan for an `[M]`/`[L]` task, with its line budget and review findings | Agents |
| `STATE.md` | Where this clone's agent is: task, gate, last green commit. Local and gitignored | Only `scripts/state.mjs` |
| `DEPLOY_INVENTORY.md`, `.env.example` | Env variable names, services, and the `H-XXX` steps only a human can do | Agents, with you |
| `.agents/` | The canonical skills and agent roles | Edit here only |
| `.claude/`, `.dsh/` | Thin pointers for each harness | Generated: `node scripts/adapters.mjs --write` |
| `scripts/` | The engine: `state.mjs` (gates and claims), `verify-wiki.mjs` (wiki checks), `adapters.mjs`, `preview.mjs` | See `scripts/README.md` |
| `.github/workflows/workflow.yml`, `.githooks/pre-push` | CI and the push guard | Template |

## Life of a task

1. **Claim.** `next-todo` picks the first free line in `TODO.md` and pushes an empty claim commit on `<type>/<slug>`. That pushed branch is the lock, so two people never take the same task.
2. **Gates.** Each task moves through gates. `node scripts/state.mjs gate` refuses a move that skips a required gate or whose checks fail.

   | Size | Path |
   | --- | --- |
   | `[S]` (≤ 150 changed lines, one module, no contract change) | `sync-wiki` if behavior changes → `build` → `pr` |
   | `[M]`/`[L]`, or auth, secrets, payments, migrations, trust boundaries | `sync-wiki` → `plan-adversary` → `build` → `pr-adversary` → `pr` |

   A task with no locked spec starts at `grill-me`, where the agent asks you questions until the spec is unambiguous.
3. **Adversaries.** `plan-adversary` and `pr-adversary` run in a fresh context that never saw the work. A `HIGH` finding blocks the task until it is fixed or a named human waives it (plans only). A `CRITICAL` finding is never waived.
4. **PR.** The agent rebases, runs the tests, ticks its `TODO.md` line and opens the PR. On `[M]`/`[L]` the PR body carries the `pr-adversary` output: its `Reviewed: <sha>` must have no diff to the PR head.
5. **CI** (`node scripts/state.mjs ci`) repeats these checks on every PR, so a branch that skipped the gates cannot pass: wiki checks, `verify_cmd`, the claim commit and branch name, the ticked line, the plan, the line budget and the bound verdict.

A new feature lands in two PRs: a `docs` task that writes and locks its wiki pages, then a build task with `after:` that waits for it. Merging the first PR is your review of the spec.

## What the agents need from you

Agents stop and wait only for these:

| Signal | What you do |
| --- | --- |
| `WIKI_GAP: …` | Answer the question; the agent writes the answer into the wiki |
| `BLOCKED: …` | Fix the cause it names (a dirty tree, a sandbox permission, a spec conflict between two branches) |
| `HUMAN_TODO: …` / `H-XXX` | Do the step only a human can do (an account, a secret, branch protection) and mark the row `done` |
| A `HIGH` finding | Let it be fixed, or waive it on a plan with `waived-by:<your name>` |
| A new dependency | Approve or refuse it |
| UI sign-off | Look at the mockup and approve it; the agent records `approved-by: <you> <date>` |

You also:

- **merge PRs one at a time**; the gates refuse a branch that is behind, so each open PR rebases after a merge.
- **release abandoned claims**: `next` shows `CLAIMED` with the author and age; delete the branch on `origin` to free it.
- **run `repo-audit`** weekly or before a release; it ends in `TODO.md` lines to append.

## Setup

1. Copy the template into the project, commit the copy, and run the `workflow-init` skill. It resolves the double-brace tokens, seeds the wiki and adds `T-001`. `next-todo` works once its PR merges.
2. Do `H-001` in `DEPLOY_INVENTORY.md`: protect the default and integration branches, require PRs and the `check` job of `.github/workflows/workflow.yml`.
3. If `verify_cmd` needs a toolchain other than Node, add its setup step to `.github/workflows/workflow.yml` before `Gates`.
4. The push guard is enabled per clone by the first `state.mjs claim` (`git config core.hooksPath .githooks`); with another hook manager, wire `node scripts/state.mjs pre-push` into it. To push a release to a protected branch on purpose: `git push --no-verify`.

## Changing the workflow itself

- Edit skills and roles only under `.agents/`, then run `node scripts/adapters.mjs --write`. CI fails when a pointer is missing, stale or orphaned. Keys that only one harness uses (such as `context: fork` in `.claude/`) stay in that pointer and are kept.
- Run every `--self-test` in `scripts/` after changing a script.
