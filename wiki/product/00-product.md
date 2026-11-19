---
status: draft
---
# Product

Source: BRIEF.md

## Problem

Shortlink: a tiny HTTP API that shortens URLs. WIKI_GAP: the underlying problem and motivation

## Goals

WIKI_GAP: goals

## Non-goals

WIKI_GAP: non-goals

## Personas

WIKI_GAP: personas

## Global NFRs

WIKI_GAP: global non-functional requirements, each as `### NFR-XXX <name>` with a `Verify:` line

## Glossary

WIKI_GAP: glossary

## Stated facts (BRIEF.md)

- HTTP API, Node >= 18, standard library only, tests with `node --test`.
- POST /links with JSON {"url": "..."} returns 201 and {"code": "<code>", "url": "..."}.
- GET /<code> redirects (302) to the stored URL; unknown code returns 404.
- Links persist in a JSON file whose path comes from env var SHORTLINK_DB.
- GET /stats/<code> returns how many times the link was followed.
