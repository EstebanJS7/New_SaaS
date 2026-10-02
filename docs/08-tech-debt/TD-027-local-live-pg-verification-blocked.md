---
id: TD-027
type: tech-debt
title:
  Local verification of applied FISC-002 schema is impossible without a
  reachable PostgreSQL
status: open
severity: low
related_epics:
  - EPIC-15
related_stories:
  - FISC-002
created: 2026-10-02
updated: 2026-10-02
---

# TD-027 — Local verification of applied FISC-002 schema is impossible without a reachable PostgreSQL

## Context

FISC-002 ships an additive migration and 22 live-PostgreSQL cases, and its
textual gates passed locally (`schema-fiscal.test.ts`, `typecheck` 14/14, `lint`
14/14, `build` 9/9, `format-check`). The live-PostgreSQL suite and `db:deploy`
were **not executed**: in the implementation environment Docker is not available
in the WSL distro, the installed PostgreSQL 16 cluster is `down`, and starting
it needs a sudo password that is unavailable. The suite derives its connection
string from `DATABASE_URL_TEST ?? DATABASE_URL` ([[TD-021]]), and neither
pointed at a reachable database.

Consequence: the migration was never applied anywhere during this slice, so the
applied enum shapes, the two CHECKs, the partial unique index predicate, the
five trigger bodies and the 22 behavioural cases are written, reviewed and
typechecked but **unproven at runtime**.

## Debt

A hidden dependency on an operator-provided database for local verification of
schema slices. A developer who cannot reach PostgreSQL cannot close a data
-foundation Story locally, and the only signal they get is an absent run rather
than a failure.

## Why It Is Safe to Defer

The gate is not lost, it is relocated: CI's `Database migrations` job applies
every migration to a fresh PG16 container and then runs the live-PostgreSQL
suite on every pull request, so the applied-schema evidence for FISC-002 is
produced by CI rather than locally. The Story therefore stays `review`, not
`done`, until a merged CI receipt exists, which is the same gate EPIC-14's
slices used.

The textual gates that did run are not a substitute for that evidence: they
assert the DDL text in `migration.sql`, not the schema PostgreSQL actually
applied.

## Risk

If the migration is wrong in a way that only PostgreSQL can observe — an invalid
predicate, a trigger that never fires, a CHECK that rejects a legitimate
transition — it would surface in CI rather than locally, costing one round trip.
The two guards corrected during implementation (the dropped external-id CHECK
and the narrowed cancellation trigger) were exactly this class of defect and
were caught by reading rather than by execution, which is evidence for the risk.

## Re-evaluation / Exit Criteria

Close when either:

- a merged CI receipt shows `Database migrations` green with the FISC-002
  migration applied and the fiscal live-PostgreSQL block executed; or
- the local environment documents a working PostgreSQL provisioning path for
  data-foundation slices.

## Related

- [[TD-021]] — the sibling live-PostgreSQL environment contract that hides the
  `?schema=public` parameter from `psql`.
- [[FISC-002]] — the Story whose only open verification item this is.
