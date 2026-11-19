---
status: draft
---
# Link stats

### US-004 See follow count

As an API client I want GET /stats/<code> so that I can see how often a link was followed.

- Given a stored code followed twice, When GET /stats/<code>, Then the response reports 2.

### FR-009 Stats

GET /stats/<code> returns how many times the link was followed.

WIKI_GAP: response format and field names; content-type; status and body for an unknown code; method not allowed; whether code "stats" can collide with the /stats route
