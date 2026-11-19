---
status: draft
---
# Link create

### US-002 Shorten a URL

As an API client I want to send a URL and get a short code so that I can share a short link.

- Given a valid url, When POST /links with {"url": "..."}, Then status 201 and body {"code": "<code>", "url": "..."}.
- Given an invalid url, When POST /links, Then status 400 and body {"error": "invalid url"}.

### FR-003 Create link

POST /links with JSON {"url": "..."} stores the link and returns 201 and {"code": "<code>", "url": "..."}.

WIKI_GAP: content-type of the response; behavior for non-JSON body, missing url field or non-string url; request content-type required; same url posted twice; method not allowed on /links

### FR-004 Url validation

A url is valid only if it uses the http or https scheme and is at most 2048 characters. Anything else is answered with 400 and {"error": "invalid url"}.

WIKI_GAP: scheme case sensitivity; whether the url is normalized before storing; length counted in characters or bytes

### FR-005 Code generation

The code is 6 random characters from a-z and 0-9. On collision with an existing code a new one is generated, at most 5 tries in total, after which the response is 503 with body "try again".

WIKI_GAP: whether 503 body is JSON {"error": "try again"} or plain text

### FR-006 Body size

A request body over 8 KiB is answered with 413 (NFR-001).

WIKI_GAP: response body of the 413; behavior when the limit is exceeded mid-stream
