---
id: DEV-001
type: story
title: Reliable local development and commercial demo
epic: EPIC-00
status: review
priority: high
depends_on: []
prd_sections: ["3", "18", "20", "42"]
permissions: []
branch: main
created: 2026-10-24
updated: 2026-10-24
---

# DEV-001 — Reliable local development and commercial demo

## Scope

User-authorized follow-up to local setup: fix `pnpm dev` and provide a guarded,
repeatable commercial demo using existing domain services. No product scope,
schema, public endpoints or architecture changes.

## Acceptance Criteria

- [x] `pnpm dev` builds required packages and starts web, API and worker with
      Nest metadata.
- [x] Backend source changes compile before restarting; type errors prevent a
      restart.
- [x] One root command loads reference/base demo data and commercial examples.
- [x] Commercial fixtures include catalog, supplier, received purchase, stock,
      completed mixed-payment sale, draft sale, and open/closed cash sessions.
- [x] Re-running the commercial seed preserves existing operations without
      duplication.
- [x] Seed refuses production and non-demo identities; private reads are tenant
      scoped.
- [x] Stock/cash/payment writes use application commands and their audits.
- [ ] Applicable lint, typecheck, tests, build and live repeatability checks
      pass.
- [x] README records Windows startup, seed contents and limitations.

## Data classification

Only synthetic demo data. Commercial values/names are INTERNAL; customer links
remain CONFIDENTIAL and are not logged. Existing demo credential policy stays
unchanged. No destructive retention, real fiscal submission or provider calls.

## Implementation Summary

No migrations, new private aggregates, public endpoints or dependencies.

- Root `pnpm dev` loads `.env`, builds backend dependencies, then starts Turbo.
  API and worker use TypeScript watch compilation, preserving Nest metadata.
  Successful recompilation precedes restart; type errors keep the last valid
  process.
- Nest startup failures reach the existing sanitized API logger via
  `abortOnError: false`.
- Worker signals belong only to `installSignalShutdown`; removing Nest's
  duplicate handlers prevents closing Redis twice on Ctrl+C.
- Prisma's runtime copy skips byte-identical files, avoiding locked DLL
  replacement on Windows without ignoring changed engine files.
- Root `pnpm db:demo` explicitly opts into development fixtures, loads both
  existing seeds and invokes a compiled commercial operator command. It resolves
  the fixed demo tenant and active owner membership before business writes.
- Commercial writes use existing permission/entitlement-aware services and
  authoritative transactions. Tenant advisory locking serializes seed runs.
  Existing named fixtures are reused and interrupted draft transitions resume.

Fixtures: four catalog items, supplier, received purchase, stock, completed
185000 PYG mixed-payment sale, draft sale, historical closed cash session
(300000 PYG, zero difference), separate open practice session (150000 PYG).

## Verification

Local verification on Windows, Node v22.14.0, Docker PostgreSQL/Redis/MinIO:

| Gate                                 | Result                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full workspace build                 | PASS, 16/16 tasks; final worker change rebuilt                                                                                                       |
| Full workspace lint + typecheck      | PASS, 46/46 tasks; final worker changes rechecked                                                                                                    |
| Modified-file formatting + JS syntax | PASS                                                                                                                                                 |
| `pnpm test:dev`                      | PASS; metadata, restart, type-error rejection, supervisor teardown                                                                                   |
| Demo guard unit tests                | PASS, 8/8                                                                                                                                            |
| Worker bootstrap/shutdown tests      | PASS, 9/9 after double-close fix                                                                                                                     |
| Earlier full worker suite            | 282 passed, 1 schema-dependent skip                                                                                                                  |
| `pnpm db:demo`                       | PASS on existing local demo; no reset                                                                                                                |
| `pnpm test:demo`                     | PASS repeatedly; no added rows/audits on two reruns, other-tenant counts preserved, stock ledger = projection, payments 185000, cash difference zero |
| Root `pnpm dev`                      | PASS; web 3000, API 3001, worker connected to Redis                                                                                                  |
| Frontend login and BFF reads         | HTTP 200; catalog 4, sales 2, cash sessions 2                                                                                                        |
| Worker console stop after fix        | No Redis double-close error; signal unit test exits 0                                                                                                |
| Full API suite outside sandbox       | 1720 passed, 48 failed, 266 live-PG cases skipped; TD-064                                                                                            |
| Full database suite                  | 541 passed, 9 failed; TD-064                                                                                                                         |
| Global test command                  | FAIL in existing Windows CLI tests; TD-064                                                                                                           |
| Global format-check                  | FAIL, 1599 existing files flagged; no bulk rewrite                                                                                                   |

The initial sandbox's HTTP EACCES failures are not the API result above; the
suite was rerun with local network access. This Node version requires
`NODE_OPTIONS=--experimental-strip-types` to load shared Vitest configuration.
No full Playwright rerun: no UI changed; HTTP smoke verified the existing BFF.

## Known Limitations / Technical Debt

- [[TD-064]] records Windows CLI/path/newline checks, stale runtime timezone
  data and repository-wide formatting. Required gates fail, so status is
  **review**, not done.
- Base fixture dates and base-seed password refresh remain unchanged. This small
  demo is not the entire dataset described by the original plan.
- Commercial names/relationships are reserved identifiers. Renaming them may
  defeat recognition. This seed does not reset user-edited operations or close
  unrelated open cash sessions. No invoices or fiscal submissions are created.
- Shared-package or `.env` edits require restarting `pnpm dev`.
