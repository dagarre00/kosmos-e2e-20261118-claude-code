---
status: locked
---
# Link create

### US-002 Shorten a URL

As an API client I want to send a URL and get a short code so that I can share a short link.

- Given a valid url, When POST /links with {"url": "..."}, Then status 201 and body {"code": "<code>", "url": "..."}.
- Given an invalid url, When POST /links, Then status 400 and body {"error": "invalid url"}.

Every response of /links is JSON with content-type `application/json`; every error body is `{"error": "<message>"}`.

### FR-003 Create link

POST /links with JSON {"url": "..."} stores the link and returns 201 and {"code": "<code>", "url": "..."}, where url is the submitted string unchanged.

- The request content-type is not checked; the body is read as JSON.
- Body that is not valid JSON: 400 {"error": "invalid json"}. The body is decoded as strict UTF-8: invalid bytes, or a leading byte order mark, also give this response.
- Valid JSON that is not an object with a string field "url" (missing, null, number, array body): 400 {"error": "invalid url"}.
- The same url posted twice creates two links with two different codes, each answered 201.
- Any other method on /links: 405 {"error": "method not allowed"} with header Allow: POST. Only the exact path /links matches; a query string is ignored.
- A failed write, or any other failure while handling the request: 500 {"error": "storage failure"} (see [[features/link-storage]]).
- Any path other than /links: 404 {"error": "not found"}.

### FR-004 Url validation

A url is valid only if the WHATWG URL parser accepts it as an absolute url whose scheme is http or https (scheme matched case-insensitively) and it is at most 2048 UTF-16 code units long. Anything else is answered with 400 and {"error": "invalid url"}. The url is stored as submitted, not normalized.

### FR-005 Code generation

The code is 6 random characters from a-z and 0-9. On collision with an existing code a new one is generated, at most 5 tries in total, after which the response is 503 with body {"error": "try again"}. A code being written by another request that is still in progress counts as taken, so two concurrent requests never end up with the same code.

### FR-006 Body size

A request body over 8 KiB (8192 bytes) is answered with 413 and {"error": "payload too large"} (NFR-001). A declared content-length over the limit is answered without reading the body; otherwise reading stops as soon as the limit is exceeded. The check comes before JSON parsing. After any 413 the response is sent and then the request is destroyed.
