---
status: locked
---
# Link storage

### US-001 Links survive restarts

As an API client I want my links kept in a file so that they still work after a restart.

- Given links were created, When the server restarts with the same SHORTLINK_DB, Then the same codes redirect to the same URLs.
- Given links were followed, When the server restarts with the same SHORTLINK_DB, Then each link keeps its follow count.

### FR-001 Database file

Links persist in a JSON file at the path in env var SHORTLINK_DB; when unset or empty the path is `./shortlinks.json`.

- The file holds one JSON object mapping each code to `{"url": "<url>", "follows": <integer>}`.
- A missing file means the server starts with no links; the file is created on the first write, not at start.
- Every change (a link created, a link followed) is written to the file before the request is answered.
- Writes are applied one at a time, in order, and each replaces the file atomically (write a temporary file next to it, then rename it over the file).
- When a write fails, the request is answered with status 500 and `{"error":"storage failure"}`, and the change is not kept in memory.

### FR-002 Corrupt database

If the SHORTLINK_DB file exists but is not usable, the server refuses to start: it writes "SHORTLINK_DB is not valid JSON" to stderr and exits with code 1.

- Not usable means: empty file, text that is not valid JSON, a file that cannot be read (any error other than the file missing), or valid JSON that is not an object of the FR-001 layout (an array, a null, a code that is not 6 characters from a-z and 0-9, an entry with any key other than url and follows, an entry whose url is not parseable by the WHATWG URL parser as an absolute url with scheme http or https (scheme matched case-insensitively) or is longer than 2048 UTF-16 code units, or whose follows is not a non-negative integer).
