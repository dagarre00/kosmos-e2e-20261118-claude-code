---
name: regen-drill
description: Prove a component page is complete by rebuilding its code from the wiki alone in a temporary worktree. Use on request or before a release, on "regen drill", "regeneration test".
---
# regen-drill

The real proof of the wiki; not a gate. Input: one non-legacy component page under `wiki/contracts/components/`.

1. `git status` must be clean, else `BLOCKED: dirty tree`. Note the page's `target` and `tests`.
2. `git worktree add --detach <temp dir outside the repo> HEAD` (if the harness confines writes to the workspace, use `<repo>/.worktrees/regen-T-XXX`, gitignored). Do everything below inside it; never touch the working branch.
3. Copy the `tests` paths, keeping their relative paths, to a second temp dir outside the worktree, then delete `target` and `tests` in the worktree.
4. Rebuild both in a fresh context that has not seen the deleted code, never a fork: use the harness's own fresh subagent mechanism with the `regen-builder` role in `.agents/agents/regen-builder.md`, its working directory set to the worktree; else a handoff and a new human-started session there. The builder may read only `wiki/`, `DEPLOY_INVENTORY.md` and `.env.example`, and must not use `git show`, `git log -p` or `git diff` on the deleted paths.
5. Delete everything the builder wrote under the `tests` paths, restore the saved originals at their paths, install project dependencies in the worktree if `verify_cmd` needs them (e.g., `node_modules`), and run `verify_cmd` from the frontmatter of `wiki/infra/00-stack.md`.
6. Report `REGEN PASS`, or each failing test as `WIKI_GAP: <what the page failed to state>`. Equivalence is same interface and same behavior, not same text.
7. Always finish with `git worktree remove --force <temp dir>` and delete the saved copy.

Each `WIKI_GAP` becomes a new `TODO.md` line; fix the page, not the drill.
