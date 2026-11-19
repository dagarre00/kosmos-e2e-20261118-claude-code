# Deploy inventory

Names only, never values. `verify-wiki.mjs --check-env` reads every table row whose first cell is a backticked `UPPER_SNAKE` name as an env variable.

## Human TODOs

| ID | Task | Status |
| --- | --- | --- |
| H-001 | Protect `{{DEFAULT}}` and `{{INTEGRATION}}`: require a PR, branches up to date before merging, and the `check` job of `.github/workflows/workflow.yml` to pass | open |
