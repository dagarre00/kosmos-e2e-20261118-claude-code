---
name: sync-wiki
description: Write or update the wiki pages a task needs, then lock them. Use at the sync-wiki gate, when behavior or contracts change, or before touching legacy code.
---
# sync-wiki

Edit only the pages this task needs, in order: domain → features → screens (`ui-mockup`) → contracts. Copy the folder's `_template.md` for a new page (component pages: `wiki/contracts/_template.md`) and link it from its folder index `wiki/<folder>/00-<folder>.md`. Two exceptions: component pages are linked from `wiki/contracts/components/00-modules.md`, as `[[contracts/components/<name>]]` outside backticks in the row's `Purpose` cell; UI contracts and other `contracts/` subfolders share `wiki/contracts/00-contracts.md`. No index yet → create it (`status: draft`, one `- [[page]]: purpose` line per page) and give it one line in `wiki/00-index.md`, which is capped at 50 lines and lists only seed pages and folder indexes.

1. IDs (`US-`, `FR-`, `NFR-`) are declared as headings and never reused, even after a page is retired. Number from the highest ID on `origin/<integration>` after a `git fetch`; a parallel branch may still take the same number, which `verify-wiki.mjs` reports after the rebase (renumber yours).
2. Component pages (`wiki/contracts/components/`) must be enough to rebuild `target` without guessing: the exact public interface in a code fence (signatures, types, error cases), plus every limit, default, constant and user-visible message in a table. State what the code must do, never how it is structured inside. Fences and tables do not count toward the word cap.
3. Before changing legacy code: create or open the `legacy` page for that file or module (`status: legacy`, `target`), and write the behavior being changed, to the same precision, under `## Specified`. When that section covers the whole target, add `implements`, `tests`, `implementation` and drop `legacy`.
4. New code needs a `locked` component page whose `target` (or `tests`) covers every new file.
5. The task adds or changes a screen → after its feature page is written and before any component page, run the `ui-mockup` skill; its sign-off is a pause. Component pages then follow the approved UI contract.
6. New service, env variable or secret → `DEPLOY_INVENTORY.md` and `.env.example` in the same commit. A trust boundary, auth, secret, payment or migration found here on an `[S]` task → raise it with `--size M` on the step 10 gate.
7. A fact you cannot get from the human or the repo → stop and emit `WIKI_GAP: <detail>`. Invent nothing.
8. Loop `node scripts/verify-wiki.mjs` until it prints `WIKI_OK`. Write to 90% of the word cap (450 words; 315 on component pages) so a later fix does not fail `size`. A `Verify:` line is the exact command, with the flags `verify_cmd` uses, and must exit `0` on this machine before the page locks.
9. Set `status: locked` on the pages you touched, UI contracts included (legacy pages stay `legacy`), rerun until `WIKI_OK`, and commit `docs(T-XXX): <what changed>`.
10. Advance: `[M]`/`[L]` → write `plans/T-XXX.md` from `plans/_template.md`, then
   `node scripts/state.mjs gate --set plan-adversary --plan plans/T-XXX.md --read plans/T-XXX.md,<page>`;
   `[S]` → `node scripts/state.mjs gate --set build --read <page>,<target>` (a `docs` task with no code: `<page>,<component page>`); it refuses while the task's linked page, or a component page implementing its IDs, is not locked.
