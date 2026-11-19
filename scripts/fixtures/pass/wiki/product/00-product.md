---
status: locked
---
# Product (pass fixture)

### NFR-001 Fast greeting

A greeting returns within 50 ms.

Verify: time 100 calls of `greet` and assert the slowest is under 50 ms.
