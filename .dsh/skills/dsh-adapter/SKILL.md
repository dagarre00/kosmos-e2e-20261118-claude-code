---
name: dsh-adapter
description: DSH-only overrides for the workflow in this harness - permissions, roles, delegation depth and worktrees. Read with any workflow skill.
---
# DSH adapter

The canonical workflow is `AGENTS.md` plus `.agents/skills/`. This file only changes how DSH runs it; the canonical rules stay authoritative.

- **Permissions.** On Windows, DSH's sandbox blocks Git transport (`fetch`, `push`, `clone`, `ls-remote`) and child-process pipes (test runners). Run `node scripts/state.mjs next`, `claim`, `test`, `--self-test`, and a finishing `gate` (`pr-adversary` or `pr`), plus raw `git fetch`/`push`/`clone`/`ls-remote`, with the shell tool's one-shot `danger-full-access` escalation. Keep edits, `state.mjs verify`, `verify-wiki.mjs` and `preview.mjs` sandboxed. A `verify_cmd` or `Verify:` line that itself spawns children (`node --test`) also needs `danger-full-access`. An escalation that is denied or times out is `BLOCKED [sandbox]`: pause and retry it. Never work around blocked transport by renaming or removing `origin`, copying objects into the remote, or merging into the integration branch yourself; a claim or PR that only exists locally is not one. `state.mjs --self-test` exiting `2` with `SELF_TEST_PARTIAL` is not a pass.
- **Roles.** DSH has no project custom-agent folder. To run `adversary`, `todo-worker` or `regen-builder`, start a fresh `subagent` with the brief "read `.agents/agents/<role>.md` (from the working directory) and run `<skill>` exactly". Never `subagent_fork` an adversary: it would inherit the context under review. Ignore those files' `tools:`/`subagents:` frontmatter; DSH's own tools apply.
- **Depth.** `subagent` delegation depth defaults to 1. A worker cannot start its own adversary; the coordinator starts it with the worker's worktree as `cwd` (or raise the Host `subagent.maxDepth` to 2). The regen builder cannot fan out at depth 1.
- **Worktrees.** The sandbox confines writes to the workspace, so create batch and regen worktrees under `<repo>/.worktrees/` (gitignored) and give the subagent that directory as `cwd`.
- **Mockups.** DSH has no HTML viewer for the human: use `node scripts/preview.mjs <name>` (escalated if the opener is blocked), else give the path. A headless browser screenshot is blocked by the sandbox; do not count on it, and record `Seen:` accordingly.
- **Read-only.** A child's permission mode follows the session, so the adversary's read-only rule is prompt-enforced. Run the session read-only for a hard boundary.
