---
status: draft
target: <source file or directory>
implements: [FR-XXX]
tests: [<test file path>]
implementation: pending
---
# <Component>

Enough to rebuild `target` without guessing: what it must do, never how it is structured inside. Component pages live in `components/`; a legacy page keeps only `status: legacy` and `target`, and adds `## Specified`.

## Interface

```
<exact public signatures, types and error cases>
```

## Behavior

| Limit, default, constant or message | Value |
| --- | --- |

## Trust boundary

<inputs validated here and how invalid input is rejected>
