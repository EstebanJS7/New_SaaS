# EPIC-19 — Imports (feature tasks)

PRD §32 asks for customer and patient imports from a spreadsheet,
asynchronously, with validation, preview and a result summary. None of it
exists.

## What exists / what does not

```text
exists        `packages/storage`: StoragePort (put/get/delete/signedUrl) behind a
              @Global() StorageModule, with S3 and in-memory drivers
              `apps/worker`: real BullMQ consumers to copy
              `POST /patients` accepts `primaryGuardianCustomerId` and creates
              patient + guardian + both audit rows in ONE transaction
              `createCustomerBody` / `createPatientBody`: exported zod schemas
              the audit writer every service uses
does not      any CSV parser, any import route, any import table, any bulk create
exist         path, `apps/api/src/files` (PRD §5 lists the domain; the directory
              does not exist)
              ANY natural unique key on `customer` beyond (tenant_id, id) —
              `customer_contact` has none either — so duplicate detection can only
              ever be a heuristic
```

## Decisions that bind this feature

| Decision    | What it fixes                                                                   |
| ----------- | ------------------------------------------------------------------------------- |
| [[DEC-068]] | CSV only; XLSX deferred to [[TD-057]], PRD deviation recorded                   |
| [[DEC-069]] | Create-only; a duplicate is a heuristic WARNING, never an update                |
| [[DEC-070]] | The patients CSV names an existing customer as guardian; unresolved = row error |
| [[DEC-071]] | Partial success, per-row summary, per-row transaction                           |
| [[DEC-072]] | Always async, upload once, ungated by feature code                              |

## The pipeline in one picture

```text
upload  →  storage (one artefact, opaque key)  →  preview (validate every row)
        →  commit (per-row transaction, valid rows land)  →  summary (per-row outcome)
```

Every step reads the SAME artefact, which is what makes the preview a promise
the commit keeps.

## Work units

Each work unit is one commit carrying its tests and documentation.

- [x] **WU-0 — the planning record.** This file, the epic, [[IMP-001]] through
      [[IMP-006]], [[DEC-068]]–[[DEC-072]] and [[TD-057]]/[[TD-058]]. No source.
- [x] **WU-A — [[IMP-001]] the import aggregate, the artefact and the
      permissions.** _Done: see the evidence log._ permissions.**
- [x] **WU-A2 — [[IMP-001A]] the shared create contracts.** _Done: see the
      evidence log._ schemas and functions to `packages/customers` /
      `packages/patients` so the worker can call them. Found while starting WU-B
      ([[DEC-073]]), not planned.
- [ ] **WU-B — [[IMP-002]] the CSV pipeline and the customer preview.**
- [ ] **WU-C — [[IMP-003]] the customer commit and its summary.**
- [ ] **WU-D — [[IMP-004]] the patient preview and commit.**
- [ ] **WU-E — [[IMP-005]] the staff surface and the e2e specs.**
- [ ] **WU-F — [[IMP-006]] the epic closure and evidence.**

## Review workload

Six work units. The riskiest is **WU-A**, because it introduces a stored
artefact containing a tenant's customer list — the one place in this epic where
personal data lives outside PostgreSQL. **WU-C/WU-D** carry the partial-commit
semantics, where a mistake means half an import landing while the summary claims
otherwise.

## Evidence log

Recorded per work unit as it lands. A work unit closes only when its own gates
were observed green.

_Empty until WU-A lands._

### WU-A — the import aggregate, the artefact and the permissions

Commit `WU-A` on `feat/epic-19-imports`.

- Migration `20261019000004_imp_001_import_aggregate`: `import_job` +
  `import_row_outcome`, three enums, four CHECK backstops, three composite FKs.
  Migrations 50 → 51.
- **The state machine is one conditional write per transition**, so a replay or
  a lost race matches zero rows and maps to ONE shared `409` whose message does
  not vary by state — the refusal is not a state oracle. `404` vs `409` is
  decided by a re-read inside the transaction before the write.
- **The row outcome carries no personal data**, asserted at compile time AND by
  a runtime scan for a name, a phone, an e-mail and a document number.
- **No artefact route exists at all**, which is stronger than the decided "the
  key never leaves the server": the worker resolves the key server-side exactly
  as the fiscal submission handler does, and a test asserts no such route can
  appear by accident.
- `imports.read` on all six roles, `imports.run` on OWNER/ADMIN. Catalog 64
  → 66.
- Gates: api **1634 → 1723** (+89), database **549 → 550**, web 1282;
  format/lint/ typecheck/build green; live PostgreSQL **266/266** over 51
  migrations.
- The new constraints were probed against a migrated database rather than
  trusted from the DDL: negative counters refused, `COMMITTED` without
  `committed_at` refused, `row_number 0` refused, and deleting the job cascaded
  its outcomes to zero.

**Collision found and handled:** the live-PostgreSQL catalog block asserts the
public schema holds no event/outbox/queue/`%job%` table. `import_job` matches
`%job%`, so the guard now excludes it BY NAME with a comment explaining that it
is a work aggregate rather than a durable event record. Renaming the aggregate
to satisfy a test heuristic would have let the pattern keep assuming something
that stopped being true.

**Skipped:** `apps/e2e` (no UI in this work unit).

### WU-A2 — the shared create contracts

Commit `WU-A2` on `feat/epic-19-imports`. A move, not a rewrite.

- `packages/customers` and `packages/patients` mirror `packages/notifications`.
  The create schemas, DTOs, row builders, audit field lists, guardian
  requirement, global-catalog check and primary-guardian link each moved to ONE
  home.
- The extracted functions take
  `{ db, audit, tenantId, actorUserProfileId, input[,  catalog] }` and open the
  transaction themselves; nothing reads an ambient request context, which is
  what makes them callable from the worker.
- The API's `create` methods delegate, still resolving tenant and actor from
  `RequestContextService` and never from a caller-supplied argument.
- **THE criterion verified by the parent**: `git diff --stat` on the customer
  and patient test files is EMPTY, and the api suite is **1723 passed before and
  after**.
- Gates: turbo 23 → **27** tasks (two new packages); format/lint/typecheck/build
  green; api 1723 unchanged, customers 7 new, patients 8 new; live PostgreSQL
  **266/266**.

**Reached slightly further than `create`, deliberately:**
`PatientsService.update` and `createGuardian` also call `assertGlobalCatalog`,
`linkPrimaryGuardian`, `appendGuardianAudit` and `assertTenantCustomer`. Leaving
those private would have kept a second copy of the same refusals, which DEC-073
forbids. The untouched patients suites are the proof that behaviour did not move
with them.

**Follow-up named, not hidden:** the two zod shims are `export *`, so they also
forward the create function and the mappers. Tightening or deleting them is a
separate cleanup.
