---
status: draft
source_roots: [src, test]
integration: main
default: main
install_cmd: 
verify_cmd: node --test
test_glob: [test/**]
---
# Stack

The frontmatter above is read by `scripts/state.mjs` and `scripts/verify-wiki.mjs`. Everything below comes from manifests only.

## Runtime

Node >= 18, standard library only. Source: BRIEF.md

## Dependencies

| Dependency | Version | Purpose |
| --- | --- | --- |
| none | | standard library only (BRIEF.md) |

## Commands

| Action | Command |
| --- | --- |
| build | |
| run | |
| test | `node --test` (BRIEF.md; not yet wired into `verify_cmd`) |

## Layout

| Path | Holds |
| --- | --- |
| `src/` | application code (not yet created) |
| `test/` | tests (not yet created) |

## Not regenerable from text

| File | Comes from |
| --- | --- |
