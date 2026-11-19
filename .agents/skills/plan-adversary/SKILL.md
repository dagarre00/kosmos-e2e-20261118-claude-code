---
name: plan-adversary
description: Adversarial read-only review of a task plan and the wiki changes it rests on. Use at the plan-adversary gate, or on "review the plan", "attack the plan".
---
# plan-adversary

Fresh, read-only context: a fresh subagent or fork of the harness (the `adversary` role when it exposes custom agents), started with only this skill and the plan path; with none, write a handoff from `handoffs/_template.md` and have a human start a new session with it. Never review a plan you wrote in this session.

Read only the plan (`Plan` in `STATE.md`, else `plans/T-XXX.md`), the wiki pages it links, and the branch's spec diff, `git diff origin/<integration>...HEAD -- wiki/ DEPLOY_INVENTORY.md .env.example` (`integration` is in the frontmatter of `wiki/infra/00-stack.md`). Edit nothing.

Report in ≤ 200 words, as rows for the plan's findings table:

`| severity | file:line | rule | fix | status |` with status `open`

Look for:
- anything a builder holding only those pages would have to guess
- in the wiki diff: a weakened or dropped requirement, a contradiction with another page, a limit, default or message left unstated, a screen without an approved UI contract
- an `FR-` the plan does not trace to a file, or a source file not traced to an `FR-` (wiki pages, `TODO.md`, `plans/`, `DEPLOY_INVENTORY.md` and `.env.example` need no `FR-`)
- layering breaks (a page or module depending outward)
- missing validation at a trust boundary
- races and data loss
- over-engineering: an abstraction with one caller, an option nobody asked for, a new dependency, any code behavior not traced to an `FR-`, anything a lower ladder rung would solve

Severity: `CRITICAL` (security, data loss, breaks a locked requirement), `HIGH`, `MEDIUM`, `LOW`. `CRITICAL` cannot be waived; `HIGH` needs `waived-by:<name>` from a named human.

End with a delete list: what should not be built. A plan with nothing to report is a valid result: output the single line `Findings: none` instead of rows.

The main agent then copies the rows (or the `Findings: none` line) into the plan, fixes them or pauses for the human on any `HIGH`, and runs the gate below. A fix that changes a page already `locked` on `origin/<integration>` changes a spec the human approved: commit it on its own as `docs(T-XXX): spec change after approval: <page>`, say so to the human, and list those pages under `Spec changed after approval` in the PR body. Then
`node scripts/state.mjs gate --set build --plan plans/T-XXX.md`. The gate refuses a plan that has neither.
