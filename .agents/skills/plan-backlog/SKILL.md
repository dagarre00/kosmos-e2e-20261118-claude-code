---
name: plan-backlog
description: Turn the product brief into draft wiki pages and an ordered, dependency-tagged TODO.md backlog. Use for the seed-backlog task, after workflow-init, or on "seed the backlog", "plan the backlog", "create the todos".
---
# plan-backlog

The work of the `seed-backlog` task, claimed with `next-todo`. Read `wiki/product/00-product.md`, its `Source:` brief, `TODO.md` and the folder index pages. Write no code.

1. Grill the human with the `grill-me` rules (three to five questions per turn, rung 1 on every scope addition) until `00-product.md` has no `WIKI_GAP`: problem, goals, non-goals, personas, global `NFR-`s with `Verify:` lines, glossary. Then the feature list: name, one-line outcome, persona, whether it has a screen, and what it needs from other features.
2. Advance: `node scripts/state.mjs gate --set sync-wiki --next "write the backlog pages"`.
3. Write, from each folder's `_template.md`:
   - one `domain/` page per shared entity named by two or more features, `status: draft`
   - one `features/<feature>.md` per feature, `status: draft`, its `US-` and `FR-` headings numbered from the highest on `origin/<integration>`, with what is already agreed and `WIKI_GAP: <detail>` for the rest
   - the folder indexes `wiki/domain/00-domain.md` and `wiki/features/00-features.md`, each linked once from `wiki/00-index.md`
4. Lock `00-product.md` once it has no gaps (feature pages stay `draft`; each one locks in its own task).
5. Append two lines per feature to `TODO.md`, in dependency order, with the next free `T-` numbers after a `git fetch`:
   - `- [ ] T-a | <feature>-spec | [S] | docs | wiki/features/<feature>.md | US-…, FR-… | page and its component pages locked; UI contract approved if it has a screen; WIKI_OK`, with `after:` the spec tasks of the features it needs
   - `- [ ] T-b | <feature> | [M] | feat | wiki/features/<feature>.md | FR-… | every FR- implemented and tested; implementation: done | after:T-a` plus the build tasks of features whose code it calls
   
   Size by the `TODO.md` header; split anything `[L]`. `after:` only for a real prerequisite: fewer edges, more parallel work.
6. Loop `node scripts/verify-wiki.mjs` until `WIKI_OK`, commit `docs(T-XXX): seed backlog`, then `node scripts/state.mjs gate --set build --read TODO.md,wiki/features/00-features.md` and follow the finish order in `AGENTS.md`.

Spec tasks run one at a time with the human (grill-me, sync-wiki, ui-mockup pause for answers); build tasks are what `batch-todos` runs in parallel.
