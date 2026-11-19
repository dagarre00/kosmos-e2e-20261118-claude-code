---
status: locked
---
# Link redirect

### US-003 Follow a short link

As an API client I want GET /<code> to redirect so that the short link opens the original URL.

- Given a stored code, When GET /<code>, Then status 302 with Location set to the stored url.
- Given an unknown code, When GET /<code>, Then status 404 and body {"error": "not found"}.

### FR-007 Redirect

GET /<code> answers 302 with the stored url, exactly as stored, as Location and an empty body.

- A path matches only if it is `/` followed by exactly 6 characters from a-z and 0-9. Any other path (other lengths, uppercase, a trailing slash, `/`, `/stats`, `/links`) is not handled here and answers 404 {"error": "not found"} without a lookup. Paths are compared as received, not percent-decoded; a query string is ignored.
- Codes are case sensitive: an uppercase code is unknown.
- An unknown code answers 404 {"error": "not found"} with content-type `application/json`.
- HEAD answers as GET (302 with Location, or 404) with no body, and does not count a follow.
- Any other method on a matching path: 405 {"error": "method not allowed"} with header Allow: GET, HEAD. The method is checked before the lookup.
- No redirect is served when the follow cannot be stored: 500 {"error": "storage failure"} (see [[features/link-storage]]).
- Code "stats" never exists (codes have 6 characters), so /stats/<code> of the stats feature cannot collide with this route.

### FR-008 Count follow

A follow is one 302 redirect served to a GET. Each one increases the link's follows by 1 (see [[domain/link]]).

- The count is written to the database before the 302 is sent (FR-001 of [[features/link-storage]]).
- HEAD, 404, 405 and 500 answers count nothing.
- Two concurrent follows count 2.
