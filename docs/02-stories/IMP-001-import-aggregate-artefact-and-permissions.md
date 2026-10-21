---
id: IMP-001
type: story
title: The import aggregate, the artefact and the permissions
epic: EPIC-19
status: done
priority: high
depends_on: []
prd_sections:
  - "32"
permissions:
  - imports.run
  - imports.read
branch: feat/epic-19-imports
created: 2026-10-19
updated: 2026-10-19
---

# IMP-001 — The import aggregate, the artefact and the permissions

## Objective

Give an import a durable identity: which tenant, which entity, which stored
file, what state, and a per-row outcome that survives the request that produced
it — plus the `imports.*` permissions that guard it.

## Context

Nothing about importing exists. `packages/storage` already provides the artefact
boundary ([[DEC-072]]) and the audit writer already exists, so this Story adds
the aggregate and reuses both.

This is the unit where the epic's one genuine data-handling risk lives: a stored
file containing a tenant's customer list, outside PostgreSQL, needing a
classification, a TTL and a cleanup ([[TD-058]] records that no retention policy
exists to be consistent with).

## In Scope

- `import_job`: id, tenant, entity (`CUSTOMER` | `PATIENT`), state machine, the
  opaque storage key, content type, byte size, the operator's membership id, the
  three counters (created / failed / suspected-duplicate) and timestamps.
- `import_row_outcome`: the per-row verdict — row number, status, a stable
  reason code and a human message. **No row payload**: never the customer's
  name, phone or document. [[DEC-071]] made the outcome the durable artefact;
  the data it describes is already in the record the import created.
- The state machine, explicit and closed: `UPLOADED` → `PREVIEWING` →
  `PREVIEWED` → `COMMITTING` → `COMMITTED`, with `FAILED` and `EXPIRED`
  terminal. Transitions are commands, never a `PATCH status=`.
- The artefact: a `put` through `STORAGE_PORT` under an opaque key, with the TTL
  and the deletion-on-terminal rule stated in one place.
- `imports.run` and `imports.read` in `PERMISSION_SEEDS`, mapped to roles, with
  the RBAC route pins.
- The upload endpoint: multipart, a size limit, a content-type allowlist that
  accepts CSV and refuses anything else by name.

## Out of Scope

- Parsing, validation, preview and commit — [[IMP-002]] onwards.
- XLSX ([[DEC-068]], [[TD-057]]).
- Any UI ([[IMP-005]]).

## Acceptance Criteria

- [x] The aggregate exists with its state machine, and an illegal transition is
      a stable refusal rather than a silent write.
- [x] The uploaded file lands in storage under an opaque key; the key never
      leaves the server, and no browser-reachable URL is ever issued for it.
- [x] The row-outcome table stores a verdict and a reason and **no personal
      data** — asserted structurally, not by convention.
- [x] `imports.run` and `imports.read` are seeded, mapped, enforced server-side
      and pinned in the RBAC route-contract probe.
- [x] Every import read is tenant-scoped; a foreign import id is a `404`.
- [x] The upload refuses an oversized file and a non-CSV content type with
      distinct stable messages.
- [x] The artefact is deleted when the import reaches a terminal state, and the
      TTL covers an import that never does.
- [x] Required loading/error/empty/success UX: N/A, no UI in this Story.
- [x] Required audit exists: the import's own transitions are audited.
- [x] Tests required by the Story pass.

## Domain Invariants

- The tenant comes from the request context, never from the body.
- The storage key is opaque and server-generated; a caller cannot choose it.
- A row outcome is a verdict, not a copy of the row.
- The state machine has no path back from a terminal state.

## API

### Added

```text
POST /imports                    multipart upload → { importId, state }
GET  /imports                    the tenant's imports, bounded page
GET  /imports/:id                one import with its counters
```

### Changed

```text
None
```

## Database

### Migration

```text
import_job, import_row_outcome, their enums, indexes and the tenant composite keys.
```

### Models/Tables

- `ImportJob` → `import_job`
- `ImportRowOutcome` → `import_row_outcome`

## UI

- None in this Story.

## Implementation Summary

Implemented on `feat/epic-19-imports`.

- **The state machine is closed and every transition is one conditional write.**
  A single private `transition(id, allowedFrom, data)` does
  `updateMany({ where: { id, tenantId, state: { in: allowedFrom } }, data })`,
  so the read-then-write race has nowhere to hide: a replay finds the row
  already advanced, a lost race finds the winner's state, and both match ZERO
  rows. The repository returns `false`; the service maps it to one shared stable
  `409` whose message does not vary by state — so the refusal is not a state
  oracle. The `404`/`409` split is made by re-reading inside the transaction
  BEFORE writing. `IMPORT_JOB_TERMINAL_STATES` and the non-terminal set derive
  from one another, so they cannot drift.
- **The row outcome carries no personal data**, and that is a structural fact
  rather than a policy: a compile-time exact-key pin plus a runtime scan of a
  persisted row for a customer name, a phone, an e-mail and a document number.
  The rationale is in a model comment — the row the outcome describes is already
  stored as the record the import created, so copying it here would duplicate
  personal data into a table with no retention story.
- **There is no route that serves the artefact back, at all.** DEC-072 said the
  key never leaves the server; the implementation went further and ships no
  download endpoint, so the worker resolves `storage_key` server-side exactly as
  the fiscal submission handler resolves its own document key. The upload
  response is literally `{ importId, state }`, and a test asserts no artefact
  route exists.
- The artefact is `put` under
  `createOpaqueStorageKey(STORAGE_KEY_PREFIXES.importArtefact)`, with a 72-hour
  TTL (generous on purpose: an operator may preview and return), deleted on any
  terminal state and by a bounded sweep, idempotently.
- `imports.read` on all six roles; `imports.run` on OWNER and ADMIN only.
  Catalog 64 → 66. No feature-code gate ([[DEC-072]]).
- Three routes pinned in the RBAC probe: `imports.run` on the upload,
  `imports.read` on the two reads.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks)
pnpm typecheck      PASS  (23/23)
pnpm build          PASS  (13/13)
pnpm test           PASS  (23/23)
  api        116 files (114 landed + 2 new)      1723 passed | 266 skipped  (+89)
  database    30 files                            550 passed  (+1)
  web        118 files                           1282 passed
```

89 new tests: 63 service and 25 integration, plus one RBAC pin. The transition
contract is exercised as a 42-case matrix (six commands × seven states) rather
than a happy path, plus replay, terminal-exit, foreign-id and idempotency cases.

**Live PostgreSQL: 266/266 over 51 migrations**, and the new constraints were
probed directly against a migrated database rather than assumed from the DDL:

```text
job insertado: UPLOADED / expires +72h
OK: rechazo creado_count negativo                 (import_job_counters_non_negative)
OK: rechazo COMMITTED sin committed_at            (import_job_committed_at_check)
OK: rechazo row_number 0                          (import_row_outcome_row_number_positive)
outcomes: 2                                       (one CREATE, one FAILED + duplicate flag)
outcomes tras borrar el job: 0                    (composite FK ON DELETE CASCADE)
```

## Tests Added

- The state machine: every legal transition, every refused one.
- Tenant isolation on all three routes.
- The upload: size limit, content type, and that the storage key is opaque.
- The row outcome has no personal-data field, asserted structurally.
- The RBAC pins.

## Known Limitations

- **A pre-existing test pattern collided with the new table and had to be
  narrowed.** The live-PostgreSQL catalog block asserts that the public schema
  holds no event/outbox/queue/`%job%` table, as proof that a catalog mutation
  emits no event. `import_job` matches `%job%`, so the guard now excludes it
  **by name** with a comment saying why: it is a work aggregate for an uploaded
  file, not a durable record of an emitted event. The alternative — renaming a
  domain aggregate to satisfy a test heuristic — would have let the pattern keep
  silently assuming something it stopped being true about.
- **`findOverdue` deliberately does not filter on state.** Filtering to
  non-terminal states would orphan the artefact of a finished import whose
  deletion failed earlier, because nothing else ever revisits it.
- **The TTL sweep is tenant-scoped and unscheduled.** Every query in the module
  carries the tenant predicate implicitly, so one call drains one tenant,
  bounded at 100. A platform-wide scheduler is the worker's job; this Story
  ships the mechanism, matching how it ships the state machine without the work
  behind `PREVIEWING`/`COMMITTING`.
- Two audit actions beyond the five the Story listed: `import.previewing` and
  `import.committing`. "Every transition is audited" requires a name for
  entering a state, and recording `import.previewed` before the preview ran
  would be a lie.
- `failure_reason` and `message` are `VarChar(500)` rather than `TEXT`: a column
  bound is the only bound that cannot be forgotten.
- The 5 MiB cap needed a per-request `limits` override on `request.parts()`,
  because `@fastify/multipart` is registered globally with the branding asset
  ceiling (2 MiB). Without it a 2.5 MiB CSV would have died with a branding
  message.

## Technical Debt

- [[TD-058]] — the artefact's retention has no approved policy behind it.
- [[TD-057]] — XLSX, deferred by [[DEC-068]].

## Decisions / ADRs

- [[DEC-072]] — always async, upload once, ungated.

## Files / Modules

- `packages/database/prisma/schema.prisma` and a new migration
- `apps/api/src/imports/`
- `packages/database/src/reference-seed.ts`
- `apps/api/src/rbac/route-contract.probe.test.ts`

## Completion Notes

All required gates passed on 2026-10-19, including the live-PostgreSQL lane and
direct probes of the new constraints.
