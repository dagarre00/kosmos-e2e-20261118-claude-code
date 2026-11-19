# Deploy inventory

Names only, never values. `verify-wiki.mjs --check-env` reads every table row whose first cell is a backticked `UPPER_SNAKE` name as an env variable.

## Human TODOs

| ID | Task | Status |
| --- | --- | --- |
| H-001 | Protect `main`: require a PR, branches up to date before merging, and the `check` job of `.github/workflows/workflow.yml` to pass | open |
| H-002 | Set verify_cmd in wiki/infra/00-stack.md once tests exist | open |

