# BRIEF

Shortlink: a tiny HTTP API in Node ≥ 18, standard library only, tests with `node --test`.
- POST /links with JSON {"url": "..."} returns 201 and {"code": "<code>", "url": "..."}.
- GET /<code> redirects (302) to the stored URL; unknown code returns 404.
- Links persist in a JSON file whose path comes from the env var SHORTLINK_DB.
- GET /stats/<code> returns how many times the link was followed.
