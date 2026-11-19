---
status: locked
target: src/server.mjs
implements: [FR-003, FR-004, FR-005, FR-006]
tests: [test/create.test.mjs]
implementation: pending
---
# Link create component

HTTP server and the POST /links handler described in [[features/link-create]]. Uses the store of [[contracts/components/link-storage]].

## Interface

```
createApp(store: Store): http.Server      // not listening; routes only /links in this feature
startServer(store: Store, port?: number = Number(process.env.PORT) || 3000): Promise<http.Server>   // listens on port (NFR-002)
// running `node src/server.mjs` directly: openStore() then startServer(store)

POST /links  body {"url": string}  -> 201 {"code": string, "url": string}
errors: 400 {"error":"invalid json"} | 400 {"error":"invalid url"} | 413 {"error":"payload too large"}
        | 405 {"error":"method not allowed"} + Allow: POST | 404 {"error":"not found"} | 503 {"error":"try again"} | 500 {"error":"storage failure"}
```

## Behavior

| Limit, default, constant or message | Value |
| --- | --- |
| Response content-type | application/json |
| Path | exact /links, query string ignored |
| Request content-type | not checked |
| Body limit | 8192 bytes; content-length above it rejected unread; else reading stops once exceeded |
| Check order | method, size, JSON, url, code, write |
| Url rule | WHATWG URL parse, absolute, scheme http or https case-insensitive, at most 2048 UTF-16 code units; stored as submitted |
| Code | 6 characters a-z0-9, random; new code if store.has(code) or the code is in the in-process set of in-flight codes; 5 tries in total, then 503 |
| In-flight codes | a drawn code is added to an in-process Set before store.set and removed once set settles (resolved or rejected) |
| Other paths | 404 {"error":"not found"} |
| Streamed 413 | response sent, then the request is destroyed |
| Any other error or throw while handling | 500 {"error":"storage failure"} |
| Same url twice | two links, two codes |
| Write | store.set(code, url); StorageError becomes 500 |
| Port | PORT, default 3000 |
| Dependencies | none; Node built-ins only |

## Trust boundary

The request body is the only untrusted input. It is size-limited, parsed as JSON and its url validated here before anything is stored.
