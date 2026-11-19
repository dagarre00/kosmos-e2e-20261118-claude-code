---
status: locked
---
# Product

Source: BRIEF.md

## Problem

Shortlink is a tiny HTTP API that stores a URL under a short code and redirects callers who request that code.

## Goals

- Create a short code for a URL through one HTTP call.
- Redirect a request for a code to its stored URL.
- Report how many times a link was followed.
- Keep links across restarts in one JSON file.

## Non-goals

- No user interface.
- No authentication or authorization.
- No dependencies beyond the Node standard library.

## Personas

- API client: a program or developer calling the HTTP API.

## Global NFRs

### NFR-001 Request body limit

A request body larger than 8 KiB (8192 bytes) is answered with status 413.

Verify: a test sends a body of 8193 bytes and expects 413.

### NFR-002 Listening port

The server listens on the port in env var PORT, default 3000.

Verify: a test starts the server with PORT set and with PORT unset and checks the port used.

### NFR-003 Runtime

Node 18 or newer, standard library only, tests run with `node --test`.

Verify: `node --test` exits 0 and no file imports a non-built-in module.

## Glossary

- Link: a stored pair of code and URL.
- Code: 6 characters from a-z and 0-9 identifying a link.
- Followed: counted by the stats feature.

## Stated facts (BRIEF.md)

- HTTP API, Node >= 18, standard library only, tests with `node --test`.
- POST /links with JSON {"url": "..."} returns 201 and {"code": "<code>", "url": "..."}.
- GET /<code> redirects (302) to the stored URL; unknown code returns 404.
- Links persist in a JSON file whose path comes from env var SHORTLINK_DB.
- GET /stats/<code> returns how many times the link was followed.
