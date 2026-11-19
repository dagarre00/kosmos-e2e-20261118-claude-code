---
name: next-todo
description: Pick and claim the next task from TODO.md. Use to start work or a session, or on "next todo", "next task", "what should I do next".
---
# next-todo

Read only `STATE.md`, the output of `node scripts/state.mjs next`, `wiki/00-index.md` and the frontmatter of the task's linked wiki page. Nothing else.

1. Check `git branch --show-current` and `STATE.md`. If `STATE.md` exists, its `Branch` matches the current branch and its `Active TODO` is a task ID (not `—`, which is idle), resume it: do its `Next action` and stop here. (A ticked `TODO.md` line does not end a task; the tick is part of finishing it.) `Gate: pr` with its PR already open → say so and stop.
2. `git status`. Dirty tree → `BLOCKED: dirty tree`. Never stash, reset or discard.
3. Run `node scripts/state.mjs next`. It fetches and lists unticked tasks in order as `FREE`, `WAITING` (an `after:` task is not merged yet; never offer it), or `CLAIMED` with who holds the branch and since when. Propose exactly one task: the first `FREE` line, unless the human names another. Never take a `CLAIMED` task; if a claim looks abandoned, report it and let the human decide. `NONE` → say so and stop. State the ID and its acceptance criterion in one line.
4. Set the size from the definitions in the `TODO.md` header. Use at least `M` for anything touching auth, secrets, payments, migrations or a trust boundary. If your size differs from the line's, say so.
5. Choose the initial gate, first match wins:
   - a linked page whose `status` is not `locked` or `legacy` → `grill-me` (no linked page, `—`, needs no spec: go on)
   - `status` is `legacy`, or behavior or contracts change → `sync-wiki`
   - `[M]`/`[L]` → `plan-adversary`
   - otherwise → `build`
6. Claim it:
   `node scripts/state.mjs claim --todo T-XXX --type <type> --slug <slug> --size <S|M|L> --gate <gate>`
   `<type>` and `<slug>` are the ones on the task's `TODO.md` line; the branch name is the lock, so no other name is accepted. `BLOCKED [branch]` or `[claim]` (someone claimed it first) → go back to step 3, at most twice (parallel sessions race for the same first line). Any other exit `2` → report the printed `BLOCKED` line and stop. `Claim: local-only` → say so: nobody else can see this claim.
7. Read `STATE.md`. If `Gate` is `plan-adversary` and `plans/T-XXX.md` does not exist, write it from `plans/_template.md` (pass `--plan plans/T-XXX.md` when advancing to `build`). Do `Next action`; for the `seed-backlog` task, run the `plan-backlog` skill instead of `grill-me` or `sync-wiki`.

One TODO per session. Do not start a second task.
