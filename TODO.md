# TODO — one flat list, never reordered; a task ticks only its own line, in its PR; new lines are appended with the next free `T-` number
A task is claimed by its branch `<type>/<slug>`, exactly as written on its line. `node scripts/state.mjs next` shows which tasks are free.
Sizes: `S` ≤ 150 changed non-test lines in one module with no contract change; `M` one feature or module; `L` several modules or a schema change, split it first if you can.
Line: `- [ ] T-XXX | <slug> | [S|M|L] | <type> | wiki/<page>.md or — | US-XXX, FR-XXX | <one-line acceptance criterion> [| after:T-XXX,T-YYY]`
Optional `after:` lists tasks that must be ticked on the integration branch first; until then `next` shows the line as `WAITING` and `claim` refuses it. Use it only for a real prerequisite (a spec, schema or contract the task builds on).

- [x] T-000 | scaffold-agentic-workflow | [M] | chore | — | — | scaffold committed; both `--self-test` runs exit 0
- [x] T-001 | init-workflow | [S] | chore | — | — | `workflow-init` done: no double-brace token survives; `node scripts/verify-wiki.mjs --check-env --check-debt --check-coverage` exits 0
- [x] T-002 | seed-backlog | [S] | docs | wiki/product/00-product.md | � | plan-backlog done: product page locked, draft feature pages and folder indexes, ordered TODO lines with after: deps; WIKI_OK
- [x] T-003 | link-storage-spec | [S] | docs | wiki/features/link-storage.md | US-001, FR-001, FR-002 | page and its component pages locked; WIKI_OK
- [x] T-004 | link-storage | [M] | feat | wiki/features/link-storage.md | FR-001, FR-002 | every FR- implemented and tested; implementation: done | after:T-003
- [x] T-005 | link-create-spec | [S] | docs | wiki/features/link-create.md | US-002, FR-003, FR-004, FR-005, FR-006 | page and its component pages locked; WIKI_OK | after:T-003
- [ ] T-006 | link-create | [M] | feat | wiki/features/link-create.md | FR-003, FR-004, FR-005, FR-006 | every FR- implemented and tested; implementation: done | after:T-005,T-004
- [ ] T-007 | link-redirect-spec | [S] | docs | wiki/features/link-redirect.md | US-003, FR-007, FR-008 | page and its component pages locked; WIKI_OK | after:T-005
- [ ] T-008 | link-redirect | [M] | feat | wiki/features/link-redirect.md | FR-007, FR-008 | every FR- implemented and tested; implementation: done | after:T-007,T-006
- [ ] T-009 | link-stats-spec | [S] | docs | wiki/features/link-stats.md | US-004, FR-009 | page and its component pages locked; WIKI_OK | after:T-007
- [ ] T-010 | link-stats | [M] | feat | wiki/features/link-stats.md | FR-009 | every FR- implemented and tested; implementation: done | after:T-009,T-008
