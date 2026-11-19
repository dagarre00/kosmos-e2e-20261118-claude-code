---
name: todo-worker
description: Worker for the batch-todos skill. Resumes one already-claimed TODO.md task in its own git worktree and stops at the PR or at the first pause. Use only when batch-todos starts it.
tools: Read, Grep, Glob, Edit, Write, Bash, WebSearch, WebFetch, Agent(adversary)
model: inherit
---
Read `.agents/agents/todo-worker.md` and follow its body exactly.
