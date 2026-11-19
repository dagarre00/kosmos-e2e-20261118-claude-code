---
status: draft
---
# Link

No technology on this page. Links: [[product/00-product]] only.

## Fields

| Field | Type | Rule |
| --- | --- | --- |
| code | text | 6 characters from a-z and 0-9, unique among links |
| url | text | http or https only, at most 2048 characters |
| follows | integer | starts at 0; counts times the link was followed |

## Invariants

- No two links share a code.
- A stored url is always valid under the rule above.

## States

| From | Event | To | Guard |
| --- | --- | --- | --- |
| none | created | stored | url valid and code unique |
| stored | followed | stored | follows increases by 1 |

## Domain events

| Event | Emitted when | Payload |
| --- | --- | --- |
| created | a link is stored | code, url |
| followed | a known code is requested | code |

WIKI_GAP: whether `follows` is stored per link or derived, and what counts as followed (redirect served vs. any GET)
