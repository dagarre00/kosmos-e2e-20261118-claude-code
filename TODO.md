# TODO — one flat list, never reordered; a task ticks only its own line, in its PR; new lines are appended with the next free `T-` number
A task is claimed by its branch `<type>/<slug>`, exactly as written on its line. `node scripts/state.mjs next` shows which tasks are free.
Sizes: `S` ≤ 150 changed non-test lines in one module with no contract change; `M` one feature or module; `L` several modules or a schema change, split it first if you can.
Line: `- [ ] T-XXX | <slug> | [S|M|L] | <type> | wiki/<page>.md or — | US-XXX, FR-XXX | <one-line acceptance criterion> [| after:T-XXX,T-YYY]`
Optional `after:` lists tasks that must be ticked on the integration branch first; until then `next` shows the line as `WAITING` and `claim` refuses it. Use it only for a real prerequisite (a spec, schema or contract the task builds on).

- [x] T-000 | scaffold-agentic-workflow | [M] | chore | — | — | scaffold committed; both `--self-test` runs exit 0
- [x] T-001 | init-workflow | [S] | chore | — | — | `workflow-init` done: no double-brace token survives; `node scripts/verify-wiki.mjs --check-env --check-debt --check-coverage` exits 0
- [ ] T-002 | seed-backlog | [S] | docs | wiki/product/00-product.md | � | plan-backlog done: product page locked, draft feature pages and folder indexes, ordered TODO lines with after: deps; WIKI_OK
