---
status: draft
---
# Modules

One row per top-level module. A module listed only here is legacy: `sync-wiki` creates its component page the first time a task touches it.

| Path | Purpose |
| --- | --- |
| `src/storage.mjs` | JSON file persistence of links, see [[contracts/components/link-storage]] |
| `src/server.mjs` | HTTP server and POST /links, see [[contracts/components/link-create]] |
