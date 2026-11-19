---
status: locked
target: src/server.mjs
implements: [FR-007, FR-008]
tests: [test/redirect.test.mjs]
implementation: pending
---
# Link redirect component

The GET /<code> handler of [[features/link-redirect]], added to the server of [[contracts/components/link-create]]. Uses the store of [[contracts/components/link-storage]].

## Interface

```
createApp(store) also routes GET|HEAD /<code>:
GET  /<code>  known   -> 302, Location: stored url, empty body; store.follow(code) completes before the response is sent
HEAD /<code>  known   -> 302, Location: stored url, empty body; no follow
GET|HEAD /<code> unknown, or any path not matching /[a-z0-9]{6} -> 404 {"error":"not found"}
other method on /<code> -> 405 {"error":"method not allowed"} + Allow: GET, HEAD
StorageError from store.follow -> 500 {"error":"storage failure"}, no Location
```

## Behavior

| Limit, default, constant or message | Value |
| --- | --- |
| Path match | `/` + exactly 6 chars a-z0-9, compared as received (no percent-decoding), query string ignored |
| Case | sensitive; uppercase is unknown |
| Check order | path match, method, lookup (store.get), follow |
| Not found body | {"error":"not found"}, content-type application/json |
| Redirect | status 302, Location is the stored url unchanged, empty body |
| Counted follow | only a GET answered 302; HEAD, 404, 405, 500 count nothing |
| Routes owned elsewhere | /links is handled by link-create; /, /stats and other non-matching paths answer 404 |
| Dependencies | none; Node built-ins only |

## Trust boundary

The request path is the only untrusted input; it is matched against the strict code pattern before any store lookup.
