---
name: batch-todos
description: Coordinate several TODO.md tasks in parallel, one worker per git worktree. Use on "batch todos", "run N tasks in parallel", "work the backlog with several agents".
---
# batch-todos

You are the coordinator: you claim tasks for workers and relay what they report. You build nothing and never answer a pause for the human. Input: `N`, the number of workers (default 3).

1. `git status` must be clean, else `BLOCKED: dirty tree`. Run `node scripts/state.mjs next --limit <2N>`.
2. Pick up to `N` `FREE` tasks that need no human mid-task: the linked page is `locked` (read its frontmatter on `origin/<integration>`), the line is not a `-spec` task, and no two picked tasks share a linked page or a component `target`. Report the rest in one line each with the reason.
3. For each pick, one worktree per worker, then claim from inside it:
   `git worktree add --detach <repo>-wt/T-XXX origin/<integration>` (if the harness confines writes to the workspace, use `<repo>/.worktrees/T-XXX`, gitignored)
   `node scripts/state.mjs claim --todo T-XXX --type <type> --slug <slug> --size <size> --gate <gate>` (cwd: the worktree; gate per `next-todo` step 5)
   `BLOCKED [claim]` → drop it and do not replace it. Install dependencies in each worktree if `verify_cmd` needs them.
4. Start one worker per worktree in a fresh context via the harness's own subagent or agent mechanism; use the `todo-worker` role in `.agents/agents/todo-worker.md` when the harness exposes named agents. Set its working directory to that worktree. If the harness caps delegation depth, start the `adversary` from this coordinator with the worker's worktree; otherwise the worker starts it. With no subagent mechanism, write `handoffs/active-handoff.md` inside each worktree and have the human start one session per worktree. The common brief: "Your working directory is `<worktree>`; never leave it. Never claim another task. Stop at the PR, or at any pause, and report the line that stopped you."
5. Relay each `BLOCKED`, `WIKI_GAP`, `HUMAN_TODO`, `HIGH` finding or dependency request to the human verbatim with its `T-XXX`, and pass the answer back to that worker only.
6. Merge queue: PRs merge one at a time, by the human. After each merge, tell every worker with an open branch: `git fetch`, `git rebase origin/<integration>`, `node scripts/state.mjs test`, then redo its finishing gates (they refuse a branch that is behind, and a rebase changes the reviewed commit): `[S]` `gate --set pr`; `[M]`/`[L]` already at `pr` → `gate --set pr-adversary`, rerun `pr-adversary`, then `gate --set pr --verdict PASS --reviewed <new sha>` and replace the review in the PR body (CI checks it against the new head). Conflicts follow `AGENTS.md` (Shared repo).
7. After a task's PR merges: `git worktree remove <path>`; never with uncommitted work (report it instead). Run `next --limit <2N>` again and repeat from step 2 while the human wants more.

End with one line per task: `T-XXX <PR url | paused: reason | dropped: reason>`.
