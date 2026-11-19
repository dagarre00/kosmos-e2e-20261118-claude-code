---
status: locked
---
# Link

No technology on this page. Links: [[product/00-product]] only.

## Fields

| Field | Type | Rule |
| --- | --- | --- |
| code | text | 6 characters from a-z and 0-9, unique among links |
| url | text | absolute url that the WHATWG URL parser accepts with scheme http or https (scheme case-insensitive), at most 2048 UTF-16 code units; kept exactly as submitted |
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
| followed | a link is followed | code |

`follows` is stored per link. What counts as followed is defined by the link-redirect feature.
