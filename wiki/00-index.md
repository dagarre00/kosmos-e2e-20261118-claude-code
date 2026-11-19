---
status: draft
---
# Wiki index

Open this page only to locate another page. A link is an exact path under `wiki/` without `.md`, in double square brackets.
A page links only to its own layer number or a lower one; this page and `decisions/` are exempt.

| # | Folder | Holds |
| --- | --- | --- |
| 0 | `product/` | problem, goals, non-goals, personas, global `NFR-`s, glossary |
| 1 | `domain/` | entities, invariants, state machines, domain events; no technology |
| 2 | `features/` | `US-` stories with Given/When/Then, `FR-`s |
| 3 | `contracts/` (`components/`, `schemas/`, `ui/`) | interfaces mapped to source paths, wire schemas, trust boundaries |
| 4 | `infra/` | data stores, external services, runtime config; secrets stay in `DEPLOY_INVENTORY.md` |
| — | `decisions/` | dated decision records |

Each folder has a `_template.md` to copy. A new page is linked from its folder index `wiki/<folder>/00-<folder>.md`; this page lists only seed pages and folder indexes, and is capped at 50 lines.

## Pages

- [[product/00-product]]: problem, goals, non-goals, personas, global NFRs, glossary
- [[contracts/components/00-modules]]: every top-level module and its purpose
- [[infra/00-stack]]: runtime, dependencies, commands, layout, workflow settings
