---
status: locked
target: src/storage.mjs
implements: [FR-001, FR-002]
tests: [test/storage.test.mjs]
implementation: pending
---
# Link storage component

Persists links in the JSON file described in [[features/link-storage]].

## Interface

```
openStore(path?: string = process.env.SHORTLINK_DB ?? './shortlinks.json'): Store
  // loads the file synchronously; missing file -> empty store
  // invalid file (see FR-002) -> prints "SHORTLINK_DB is not valid JSON" to stderr, process.exit(1)

Store.get(code: string): { url: string, follows: number } | undefined
Store.has(code: string): boolean
Store.set(code: string, url: string): Promise<void>   // follows starts at 0; rejects with StorageError on write failure
Store.follow(code: string): Promise<number>           // follows += 1, returns new count; rejects with StorageError on write failure
class StorageError extends Error                      // message "storage failure"
```

## Behavior

| Limit, default, constant or message | Value |
| --- | --- |
| Env variable | SHORTLINK_DB |
| Default path | ./shortlinks.json |
| File layout | `{"<code>": {"url": "<url>", "follows": <integer >= 0>}}` |
| File creation | on first write, never at start |
| Write method | serialized queue; temporary file in the same directory, then rename over the file |
| Failed write | in-memory state unchanged; caller answers 500 `{"error":"storage failure"}` |
| Corrupt message | SHORTLINK_DB is not valid JSON (stderr) |
| Corrupt exit code | 1 |
| Corrupt cases | empty file, invalid JSON, non-object, entry with non-string url or invalid follows |

## Trust boundary

The database file is read once at start and validated entirely; any invalid content refuses start. No other input enters this component.
