---
name: pr-adversary
description: Adversarial read-only audit of a diff against the wiki. Use at the pr-adversary gate, or standalone on any PR or branch (someone else's, an [S] task, CI), on "review the diff", "audit the PR", "review PR <n>".
---
# pr-adversary

Fresh, read-only context: a fresh subagent or fork of the harness (the `adversary` role when it exposes custom agents), started with only this skill and its target; with none, write a handoff from `handoffs/_template.md` and have a human start a new session with it. Never audit a diff you wrote in this session.

`<integration>` is in the frontmatter of `wiki/infra/00-stack.md`; use it without `origin/` if there is no `origin` remote.

1. Pick the mode and the commit under review, `<sha>`:
   - **Gate** (no target given, and `STATE.md` has an active task on this branch at `Gate: pr-adversary`): `<sha>` is `git rev-parse HEAD`; the diff is `git diff origin/<integration>...HEAD`. Run both; on a non-zero exit halt and report the output with `VERDICT: BLOCKED`:
     - `node scripts/state.mjs verify`
     - `node scripts/verify-wiki.mjs --check-env --check-debt --check-coverage`
   - **Standalone** (a PR number or branch given, or no active task): never run `state.mjs`, never switch the checkout. PR → `gh pr view <n> --json headRefOid,baseRefName` gives `<sha>` and the base, and `gh pr diff <n>` the diff; branch → `git fetch origin <branch>`, then `<sha>` is `git rev-parse origin/<branch>` and the diff `git diff origin/<integration>...<sha>`. Read wiki pages at that commit with `git show <sha>:wiki/<page>.md`. Run `verify-wiki.mjs` only when `HEAD` is `<sha>` and the tree is clean; else list it as not run.
2. Read the wiki pages the diff touches or that cover the changed files, before any code.
3. Audit the diff against those pages. Every behavior, branch, constant and message in the diff that the pages do not state is an `UNSPECIFIED` finding. Severity `HIGH` when it is observable: a public interface, output, user-visible message, limit, default, error case, stored data, or anything at a trust boundary — a rebuild from the pages could differ there and a test could see it. Severity `MEDIUM` when it is internal only: names, private helpers, internal structure, debug log text. When unsure, `HIGH`. On a `legacy` page only the `## Specified` section counts as stated. A wiki-only diff: audit the pages themselves for anything a builder would have to guess.
4. Also check:
   - anything a builder holding only those pages would have to guess
   - untraced `FR-`s, layering breaks, missing validation at a trust boundary, races
   - a changed screen without a `wiki/contracts/ui/` page carrying `approved-by`
   - a `locked` wiki statement weakened or dropped in the same diff as the code that now matches it
   - over-engineering: an abstraction with one caller, an option nobody asked for, a new dependency, any source file or behavior not traced to an `FR-` (wiki pages, `TODO.md`, `plans/`, `DEPLOY_INVENTORY.md` and `.env.example` need none), anything a lower ladder rung would solve
   - tests that do not map to an acceptance criterion

Output ≤ 200 words: findings as `| severity | file:line | rule | fix | status |` rows, then the line `Reviewed: <sha>`, then a last line of exactly `VERDICT: PASS` or `VERDICT: BLOCKED`. Any open `CRITICAL` or `HIGH` → `BLOCKED`. Edit nothing.

Gate mode, on `PASS`: the main agent runs `node scripts/state.mjs gate --set pr --verdict PASS --reviewed <sha>`, then opens the PR and pastes this output into the PR body verbatim; CI (`state.mjs ci`) reads its last `Reviewed:` and `VERDICT:` lines and fails unless `<sha>` has no diff to the PR head. A rerun with the PR already open replaces that output in the body (`gh pr edit <n> --body-file <file>`). Open `MEDIUM` `UNSPECIFIED` rows do not block: state them on the page in this branch if it stays under the word cap, else append a `docs` line to `TODO.md` to specify them. Any commit after the review makes the gate refuse that `<sha>`: rerun this skill. Before each rerun the main agent checks its own fix against step 3 (every new behavior, constant and message stated on a page) so a round is not spent on wording. A third `BLOCKED` on the same task → stop and ask the human whether to split the task or keep going. Standalone: the output is a PR comment; post it only if the human asks (`gh pr comment <n> --body-file <file>`).
