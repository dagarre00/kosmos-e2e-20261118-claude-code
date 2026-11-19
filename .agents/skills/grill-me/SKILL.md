---
name: grill-me
description: Interrogate the human until a spec is unambiguous. Use at the grill-me gate, when a task has no locked spec, or on "grill me", "clarify requirements", "spec this".
---
# grill-me

Only for work without a locked spec. Write no code and no wiki pages here.

1. Ask three to five terse questions per turn, then wait. No preamble, no recap.
2. Go in order: product (problem, goal, non-goal, persona) → domain (entities, invariants, states) → features (stories, acceptance criteria, limits, defaults, error messages).
3. Challenge every answer that adds scope with ladder rung 1: "does this need to exist?" Keep it only if the human insists, and record what was dropped as a non-goal.
4. Flag each new service, env variable and dependency as you hear it. A new dependency needs explicit human approval.
5. Stop when a builder would not have to guess:
   - every story is `US-XXX` with Given / When / Then
   - every behavior is an `FR-XXX` with its limits, defaults and messages
   - every quality target is an `NFR-XXX` with a number and a `Verify:` method
6. Output the agreed list (IDs and one line each) and nothing else. IDs continue from the highest in `wiki/` on `origin/<integration>` after a `git fetch`; never reuse one.
7. Advance: `node scripts/state.mjs gate --set sync-wiki --next "write the agreed spec into wiki/"`.
