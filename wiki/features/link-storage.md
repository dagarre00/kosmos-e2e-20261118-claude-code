---
status: draft
---
# Link storage

### US-001 Links survive restarts

As an API client I want my links kept in a file so that they still work after a restart.

- Given links were created, When the server restarts with the same SHORTLINK_DB, Then the same codes redirect to the same URLs.

### FR-001 Database file

Links persist in a JSON file at the path in env var SHORTLINK_DB. If the file does not exist the server starts with no links.

WIKI_GAP: JSON file layout; whether the missing file is created at start or on first write; default when SHORTLINK_DB is unset; write failure behavior; concurrent write handling

### FR-002 Corrupt database

If the SHORTLINK_DB file exists but is not valid JSON the server refuses to start, exits with code 1 and prints "SHORTLINK_DB is not valid JSON".

WIKI_GAP: valid JSON of the wrong shape; stream (stdout or stderr) of the message
