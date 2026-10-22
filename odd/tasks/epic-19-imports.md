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
- [x] **WU-B — [[IMP-002]] the CSV pipeline and the customer preview.** Two
      commits: **WU-B1** the pure pipeline, **WU-B2** the queue, the trigger and
      the worker. _Done: see the evidence log._ commits: **WU-B1** (done) the
      pure pipeline; **WU-B2** (pending) the queue trigger, the worker consumer
      and the outcome persistence.
- [x] **WU-C — [[IMP-003]] the customer commit and its summary.** _Done: see the
      evidence log._
- [x] **WU-D — [[IMP-004]] the patient preview and commit.** _Done: see the
      evidence log._
- [x] **WU-E — [[IMP-005]] the staff surface and the e2e specs.** _Done: see the
      evidence log._
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

### WU-B1 — the pure CSV pipeline

Commit `WU-B1` on `feat/epic-19-imports`.

- `packages/imports` mirrors `packages/notifications`, depends only on
  `@newsaas/customers`, and has no Nest, no database and no queue — which is
  what will let the worker call it.
- The reader has four stable refusals (unterminated quote, field-count mismatch
  naming its row, blank line in the MIDDLE naming its row, empty file), strips a
  leading BOM, and treats a row of empty cells as DATA rather than a blank line.
- Row validation goes through the IMPORTED `createCustomerBody` and
  `createCustomerContactBody`; a test reads the source and asserts the module
  declares no `z.object`, no local max-length and no `zod` dependency.
- The conflict rule: `legal_name`/`tax_id` with `kind` absent or `INDIVIDUAL` is
  a row ERROR naming the column, never a coercion.
- The duplicate heuristic is an interface, and a test asserts a suspected
  duplicate stays `CREATE` — the warning can never become a skip.
- Gates: **28 turbo tasks**; imports **53 new tests**; api **1723 unchanged**.
- **Fixed a pre-existing flake** that kept the gate red:
  `notification-delivery.read.integration.test.ts` scanned the body for
  `\d{9,}`, which nine hex digits inside a `randomUUID()` satisfy by chance
  (~1.5 % per UUID, several per delivery). UUIDs are now masked before the scan.
  Three consecutive full-suite runs green afterwards, where two of eight had
  failed before.

**New debt named, not worked around:** [[TD-059]] — contact values are validated
by LENGTH only, so the import accepts what the endpoint accepts. Adding a check
in the import would make it stricter than the endpoint, which is the drift
DEC-073 prevents.

**Pending (WU-B2):** the queue contract, the API trigger and the worker
consumer.

### WU-B2 — the queue, the trigger and the worker

Commit `WU-B2` on `feat/epic-19-imports`.

- `packages/imports` gained the queue contract, a hyphenated job id (BullMQ
  refuses a colon in a custom id), and a producer with the queue injected.
- `runCustomerPreview` claims FIRST, so a replay or a lost race writes nothing;
  a thrown error becomes `FAILED` rather than being rethrown, because the row
  already carries the failure and the claim can never be retaken.
- `POST /imports/:id/preview` enqueues and answers `202`, refusing a
  non-`UPLOADED` import with the aggregate's `409` before touching the queue.
- The worker takes the tenant FROM the row — the one place in the import path
  where it does not come from a request context — reads the artefact through
  `STORAGE_PORT`, prefetches duplicate candidates tenant-scoped, and persists
  outcomes inside the transitions with co-committed audit rows.
- Gates: turbo 28 → **29**; imports **65**, worker **261** (+16), api **1738**
  (+15); format/lint/typecheck/build green.

**Parent corrections on top of the worker's work:**

- The API producer factory now **throws at boot** when `REDIS_URL` is absent,
  like the branding, fiscal and notification producers. The worker had made it
  fail at use because `boot-test-app.ts` was outside its surfaces; the harness
  now overrides the token like it overrides the other three. Four producers
  behaving two ways is worse than one extra override.
- A **`PATIENT` preview is refused at the API** with its own message instead of
  being enqueued and silently dropped by the handler. `FAILED` is terminal, so
  the worker could not fail it without stranding the import the day the patient
  map lands.
- `Setup.writes` / `Setup.lookups` in the worker's suite were properties used as
  namespaces; named `CapturedWrite` / `CapturedLookup` so they resolve.

**Named, not hidden:** the duplicate lookup is a prefetch because part 1's
planner is synchronous; a preview killed mid-run leaves the row `PREVIEWING`
with no writer; and the preview HTTP suite still composes its own module graph,
which is now a cheap cleanup since the harness can override the producer.

### WU-C — the customer commit and its summary

Commit `WU-C` on `feat/epic-19-imports`.

- **`createCustomer` gained optional contacts in the same transaction**
  (additive; the endpoint does not pass them). Without it an imported customer
  could have existed without the phone number that made it useful.
- **Preview-authoritative commit**: it reads the stored outcomes and creates
  only the rows the preview marked `CREATE`. Nothing is re-validated into a
  different answer.
- **Claim first**, one transaction per row, partial success that CONTINUES after
  a row failure, and a zero-accepted-rows file that commits nothing and fails
  with a reason.
- One consumer, two job names, dispatched by name — no second queue.
- Gates: customers **7 → 9**, imports **65 → 85**, worker **261 → 276**, api
  **1738 → 1758**; format/lint/typecheck/build green.

**Parent corrections on top of the worker's work:**

- **The contact create mapping existed twice** (package + `CustomersService`).
  The zod rule had one home; the mapping did not, and nothing asserted they
  agreed. Exported from `@newsaas/customers` and the API now delegates — `grep`
  shows exactly one definition.
- Two unnecessary type assertions in the consumer, which `lint` caught.

**Named, not hidden:** the artefact is deleted by the API commands and the TTL
sweep, not by the worker's terminal path (the doc claimed otherwise and was
corrected); the `CommitWriter` lives in `@newsaas/imports` because the worker
has no `@newsaas/customers` dependency; the in-memory fake ignores
`take`/`skip`, so the page bound is proven at the repository query instead.

### WU-D — the patient preview and commit

Commit `WU-D` on `feat/epic-19-imports`.

- **The pipeline was generalised, not duplicated.**
  `runImportPreview`/`runImportCommit` take an entity planner; a test runs both
  entities through both functions and then reads the runners' sources to assert
  they name no entity.
- The patient contract: `name`/`species`/`sex` required, and **exactly one**
  guardian reference column — none is an error, two is an ambiguity error.
  Species and breed resolve from the global catalog by code then name; `sex` IS
  case-folded (a closed domain vocabulary) while `kind` is NOT (a discriminator
  the endpoint would reject).
- `birth_date` is pinned to noon UTC, so the tenant-local date equals the date
  typed.
- `createPatient` is called with `primaryGuardianCustomerId`, so the deferred
  guardian trigger is satisfied by the same transaction a manual entry uses.
- Gates: imports **85 → 132**, worker **276 → 282**, api **1758 → 1760**;
  customers and patients UNCHANGED, which is the evidence that generalising was
  a refactor; live-PG **266/266**; format/lint/typecheck/build green.

**Parent corrections on top of the worker's work:**

- **`GET /imports` gained the `entity` filter** the Story promised and the
  shipped list refused as an unknown key. The in-memory fake now implements it
  in the PREDICATE, not only in the `where` type — a fake that accepts a filter
  it ignores would let the HTTP test pass while the real query returned
  everything.
- **The live-PostgreSQL spec needed the producer override too.** It composes
  `AppModule` itself rather than going through `boot-test-app.ts`, so making the
  factory throw at boot broke it. It now overrides all four producer tokens,
  like the harness does.
- One `async` test callback with no `await`, caught by lint.

**Named, not hidden:** patient rows always report `suspectedDuplicate: false` (a
pet has no natural key); guardian resolution matches the stored value exactly
and ignores `isActive` to stay no stricter than `createPatient`; and a patient
commit reads the artefact before the zero-accepted-rows check.

### WU-E — the staff surface and the e2e specs

Commit `WU-E` on `feat/epic-19-imports`.

- The BFF is a closed `(method, path shape)` allowlist: the multipart upload
  forwarded as parsed `FormData` (fetch writes its own boundary), the JSON
  routes buffered as text. Unknown path, wrong method, unknown key, malformed
  id, portal cookie and no session are all refused LOCALLY with no upstream
  call.
- **Polling stops by construction** — `refetchInterval` returns `false` outside
  `PREVIEWING`/`COMMITTING`, which clears TanStack Query's timer; asserted as
  "no further reads across six intervals".
- The row table is bounded and paginated, and an ERROR is distinguishable from a
  `suspected duplicate` warning **in text**, not only by colour.
- The summary renders from the STORED outcomes, asserted by re-mounting the
  detail.
- `Imports` joins the nav with no `requireFeature` — the third refusal of a
  thirteenth code.
- Gates: web **1282 → 1343** (+61); api 1760, imports 132, worker 282;
  format/lint/ typecheck/build green, and `build` registers `/app/imports`, its
  detail and the BFF.

**Fixed a spec that would have failed on its first real run:** it made a row
fail with a malformed e-mail, but the contact contract is length-only (TD-059),
so that row would have been created and the "find the FAILED row" step would
have thrown. It now omits `display_name`, which `createCustomerBody` itself
refuses — the same class of defect as the clinical spec that failed in CI on PR
#145.

**Not verified:** the `apps/e2e` lane cannot run here. The spec is written,
statically valid and explicitly unrun.
