---
status: draft
---
# Link redirect

### US-003 Follow a short link

As an API client I want GET /<code> to redirect so that the short link opens the original URL.

- Given a stored code, When GET /<code>, Then status 302 with Location set to the stored url.
- Given an unknown code, When GET /<code>, Then status 404.

### FR-007 Redirect

GET /<code> answers 302 with the stored url as Location. An unknown code answers 404.

WIKI_GAP: 404 response body and content-type; HEAD and other methods on /<code>; code lookup case sensitivity; paths that are not 6 characters of a-z0-9; trailing slash or query string handling

### FR-008 Count follow

Each successful redirect increases the link's follow count by 1 and the count is persisted.

WIKI_GAP: what counts as following (redirect served vs. any GET, HEAD, prefetch); persistence timing
