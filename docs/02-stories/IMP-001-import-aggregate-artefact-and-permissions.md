---
id: IMP-001
type: story
title: The import aggregate, the artefact and the permissions
epic: EPIC-19
status: planned
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

- [ ] The aggregate exists with its state machine, and an illegal transition is
      a stable refusal rather than a silent write.
- [ ] The uploaded file lands in storage under an opaque key; the key never
      leaves the server, and no browser-reachable URL is ever issued for it.
- [ ] The row-outcome table stores a verdict and a reason and **no personal
      data** — asserted structurally, not by convention.
- [ ] `imports.run` and `imports.read` are seeded, mapped, enforced server-side
      and pinned in the RBAC route-contract probe.
- [ ] Every import read is tenant-scoped; a foreign import id is a `404`.
- [ ] The upload refuses an oversized file and a non-CSV content type with
      distinct stable messages.
- [ ] The artefact is deleted when the import reaches a terminal state, and the
      TTL covers an import that never does.
- [ ] Required loading/error/empty/success UX: N/A, no UI in this Story.
- [ ] Required audit exists: the import's own transitions are audited.
- [ ] Tests required by the Story pass.

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

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The state machine: every legal transition, every refused one.
- Tenant isolation on all three routes.
- The upload: size limit, content type, and that the storage key is opaque.
- The row outcome has no personal-data field, asserted structurally.
- The RBAC pins.

## Known Limitations

- To be recorded as implemented.

## Technical Debt

- [[TD-058]] — the artefact's retention has no approved policy behind it.
- [[TD-057]] — XLSX.

## Decisions / ADRs

- [[DEC-072]] — always async, upload once, ungated.

## Files / Modules

- `packages/database/prisma/schema.prisma` and a new migration
- `apps/api/src/imports/`
- `packages/database/src/reference-seed.ts`
- `apps/api/src/rbac/route-contract.probe.test.ts`

## Completion Notes

_Status must remain non-done until all required gates pass._
