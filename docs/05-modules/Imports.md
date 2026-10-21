---
type: module
status: implemented
epic: EPIC-19
updated: 2026-10-19
---

# Imports

The imports module gives a bulk import a durable identity: which tenant, which
entity, which stored file, what state, and — from [[DEC-071]] — a per-row
outcome that survives the request that produced it. It stores the artefact, owns
the lifecycle, seeds the permissions, and — from [[IMP-002]] — runs the preview
over the stored file and persists one verdict per row. It contains **no commit
logic**: [[IMP-003]] owns applying a previewed file.

[[DEC-072]] settled the three transport questions, and this module is where
their consequences are visible:

- **always asynchronous** — an upload returns an identifier to poll, never a
  result;
- **upload once** — the preview and the commit read the SAME stored artefact, so
  "commit what you saw" is structural rather than a convention;
- **ungated by feature code** — importing is a staff action over data the tenant
  already owns, so the `imports.*` permission family is the whole guard.

## The aggregate

Two tables, one aggregate.

| Table                | Holds                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import_job`         | the tenant, the entity (`CUSTOMER` or `PATIENT`), the state, the opaque storage key, content type and byte size, the uploader, three counters, the phase instants and the artefact's TTL and deletion stamp |
| `import_row_outcome` | one row's VERDICT: the 1-based data row number, the status, a stable reason code, a bounded message and the duplicate flag                                                                                  |

`created_count + failed_count` is the number of data rows the preview saw.
`suspected_duplicate_count` is a SUBSET of `created_count`, not a third bucket
([[DEC-071]] creates the record and reports the suspicion). `row_number` is
1-based over DATA rows with the header excluded, so an operator can open the
file at exactly the row a failure names.

### The row outcome carries no personal data

`import_row_outcome` holds **no** name, phone, e-mail, document number, species
or birth date, and **no** reference to the customer or patient the row produced.
The row it describes was already written into the record the import created; a
copy here would duplicate personal data for no gain and would put a second copy
of a tenant's customer list somewhere with no retention story ([[DEC-071]]).

What is stored is a verdict. `message` names the condition — "the document
number already exists for another customer" — and never the value.

This is asserted structurally, not by convention: the projection's key set is
pinned at compile time (`ImportRowOutcomeResponse`), the runtime suite compares
the projection's keys against the same pinned list, and it scans a **persisted**
row and its projection for a name, a phone, an e-mail and a document number.

## The state machine

One closed machine. There is no `PATCH status=` and no route that accepts a
state: every arrow is an explicit command on the repository, and every command
is a **conditional `updateMany`** whose `where` pins the state it leaves.

```text
UPLOADED   → PREVIEWING → PREVIEWED → COMMITTING → COMMITTED
                  ↓                        ↓
                FAILED                   FAILED
any non-terminal → EXPIRED
```

**Terminal set: `COMMITTED`, `FAILED`, `EXPIRED`.** A terminal import has no
exit — what ran is history, and running again is a new job with a new artefact.
`isTerminal(state)` is the ONE predicate for that set, and `expire`'s source set
is DERIVED from it (`IMPORT_JOB_NON_TERMINAL_STATES`), so the two can never
drift.

| Command           | From                       | To           | Audit action        | Written by    |
| ----------------- | -------------------------- | ------------ | ------------------- | ------------- |
| —                 | (row created)              | `UPLOADED`   | `import.uploaded`   | API service   |
| `startPreview`    | `UPLOADED`                 | `PREVIEWING` | `import.previewing` | worker runner |
| `completePreview` | `PREVIEWING`               | `PREVIEWED`  | `import.previewed`  | worker runner |
| `startCommit`     | `PREVIEWED`                | `COMMITTING` | `import.committing` | API service   |
| `completeCommit`  | `COMMITTING`               | `COMMITTED`  | `import.committed`  | API service   |
| `fail`            | `PREVIEWING`, `COMMITTING` | `FAILED`     | `import.failed`     | both          |
| `expire`          | any non-terminal           | `EXPIRED`    | `import.expired`    | API service   |

The three preview transitions are written by the WORKER ([[IMP-002]]): the
phase's work happens there, so the `claim` that takes `UPLOADED → PREVIEWING` is
the same conditional `updateMany` the API's repository performs, and its audit
row co-commits in one transaction. The action codes are declared once, in
`@newsaas/imports`, precisely because two deployables write them. The API's
`startPreview` command still exists and is deliberately unused by the HTTP
surface: issuing it there would move the row off `UPLOADED` before the worker
looked at it, and the worker's claim — pinned on `UPLOADED` — would then skip
every preview.

The two phase-entry actions (`previewing`, `committing`) are there because the
Story requires EVERY transition to be audited and the five names it lists cover
only the outcomes: recording `previewed` before the preview ran would be a lie,
and recording nothing would leave a crash inside a phase with no trace.

### How a concurrent or replayed transition is refused

The write is
`updateMany({ where: { id, tenantId, state: { in: [<the states it may leave>] } }, data: { state: <the next one>, ... } })`.
The state it may leave is pinned in the SAME statement, so:

- a **replay** of a transition that already happened finds the row in the wrong
  state and matches **zero rows**;
- a **lost race** — two callers issuing the same command — serializes on the
  row: the second one's `where` no longer matches the state the first one
  committed, so it also matches zero rows;
- a command against a **terminal** import matches nothing, because no terminal
  state appears in any source set.

Zero rows is not an exception in the repository — it returns `false`. The
service turns it into ONE stable `409 CONFLICT`
(`The import is not in a state that allows this transition.`), shared by every
refused transition so the refusal is no oracle for which state the row is in. A
re-read BEFORE the write separates the two refusals a caller can deserve: an
unknown or FOREIGN import is the shared `404`, a wrong state is the `409`.

The state change and its audit row co-commit in one transaction, so a transition
without its trail cannot happen.

## The artefact

Classification, TTL and deletion, in one place.

| Property             | Value                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification       | **INTERNAL** tenant data — a customer list (PRD §41, [[DEC-072]])                                                                                       |
| Key                  | opaque, server-generated (`createOpaqueStorageKey`, prefix `import`), never returned to a client                                                        |
| Content type         | `text/csv` or `application/csv` only; `.xlsx`/`.xls` are refused BY NAME with a message that names CSV as the accepted format ([[DEC-068]], [[TD-057]]) |
| Size cap             | 5 MiB (`IMPORT_ARTEFACT_MAX_BYTES`), with its own stable `413` message                                                                                  |
| TTL                  | `artefact_expires_at = now + 72 hours`, NOT NULL on the row                                                                                             |
| Deletion on terminal | the artefact is deleted as soon as the job reaches `COMMITTED`, `FAILED` or `EXPIRED`                                                                   |
| Deletion by TTL      | `sweepOverdueArtefacts` expires the job that never finished and retries the delete for one whose removal failed                                         |
| Deletion stamp       | `artefact_deleted_at`, a compare-and-set on `IS NULL`, so deletion is idempotent                                                                        |

**Why 72 hours.** An operator may upload a file, preview it, leave for the day
and come back to commit it. A TTL short enough to expire under a working session
would turn an ordinary business flow into a support ticket, and a shorter window
buys nothing because the artefact is normally deleted the moment the import
finishes. The TTL only governs the import that never does.

**Where the file is, and is not.** The bytes live in object storage; the row
holds the key. The preview and the commit run in the worker, which resolves the
row and reads the key there — exactly as the fiscal handler resolves its own
document — so the key crosses a boundary between two deployables and never a
network boundary to a browser. There is deliberately **no public, signed or
proxy route** for the artefact: [[DEC-072]] says the surface never downloads it
back, and having no route is what keeps that true. The runtime suite asserts
that no such route exists.

**Why the TTL sweep is tenant-scoped.** Every query in this module carries the
tenant predicate implicitly, so the sweep drains one tenant at a time. A
platform-wide sweep is the worker's job (iterate tenants, or use its own
cross-tenant seam); this story ships the mechanism and the batch bound, not a
scheduler.

## The preview pipeline

[[DEC-072]] made every import asynchronous, so the preview is a queued pass over
the stored artefact — never a synchronous branch on file size.

```text
POST /imports/:id/preview          imports.run, UPLOADED only
      │  enqueue { importJobId }   (job id = `import-preview-<id>`)
      ▼
  import-processing queue   →   worker: ImportPreviewConsumer → ImportPreviewHandler
      │                              │  row = import_job.findFirst(id)   ← the tenant is READ FROM THE ROW
      │                              │  refuse if missing / not UPLOADED / entity ≠ CUSTOMER
      │                              │  read import_job.storage_key through STORAGE_PORT
      │                              │  prefetch the duplicate candidates (tenant-scoped)
      │                              ▼
      │                        @newsaas/imports: runCustomerPreview
      │                          claim()  UPLOADED → PREVIEWING   (conditional, audited)
      │                          read + planCustomerPreview
      │                          complete(rows) PREVIEWING → PREVIEWED (+counters)
      │                          fail(reason)   PREVIEWING → FAILED (+failed_at)
      ▼
  import_row_outcome ×N + the counters on import_job
```

**The job payload is one id.** No tenant, no storage key, no counts: the worker
resolves everything from the row, and a tenant in the payload would be a second
source of truth for the one fact the row owns. The job id uses a HYPHEN, because
BullMQ throws `Custom Id cannot contain :` on an id whose colon-separated form
is not exactly three segments.

**`claim` is the concurrency contract.** It is a conditional `updateMany` pinned
on `UPLOADED`; a replayed job or a lost race matches zero rows and the runner
returns `SKIPPED` having touched nothing — no second set of outcomes, no audit
row, no state change.

**A claimed phase is never left dangling silently.** Every path after the claim
settles the row, including an unexpected throw: it is turned into `FAILED` with
one fixed sentence, because an arbitrary error's text is the field most likely
to quote the record it was working on. The residual case is a process killed
mid-run — a restart or an OOM kill leaves the row `PREVIEWING` with no writer,
and the TTL sweep is what an operator has until a recovery pass exists.

**The counters are written by the transition that produced them.**
`created_count`, `failed_count` and `suspected_duplicate_count` are written in
the same statement that enters `PREVIEWED`, so a replayed settle cannot rewrite
them. The database's biconditional CHECKs are honoured by construction:
`failed_at` is written only by `fail` (state `FAILED`) and `committed_at` is
never written here.

**The duplicate lookup is a prefetch, and that is a consequence of the pure
pipeline.** `DuplicateLookup` answers synchronously — the planner is a pure
function — so the worker reads the candidate document numbers and contact values
out of the file (reusing the package's own reader and header contract), asks
about them in bounded batches of 500 values, and answers from two sets. The
queries carry the ROW's tenant explicitly: another tenant's customer with the
same document number is not a duplicate, and a lookup that leaked across tenants
would turn a warning into a disclosure. A phone number and an e-mail that share
a string are also different contacts, so a match is on `(kind, value)`.

**A suspected duplicate stays a warning.** A flagged row is still `CREATE`, the
count is a subset of `created_count`, and nothing in this path can skip a row
([[DEC-069]]).

## Permissions

| Key            | Held by                  | Why                                                                                                                           |
| -------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `imports.read` | all six roles            | Reading an import is reading a job the tenant already ran; the read-wide shape every other `*.read` key has.                  |
| `imports.run`  | `OWNER` and `ADMIN` only | It is the one action that creates hundreds of records in one go, and it is the action an operator should be deliberate about. |

No feature-code gate ([[DEC-072]]): a thirteenth code was refused after
[[DEC-058]] and [[DEC-062]] refused the same move. The module imports no
`EntitlementsModule`, and the service re-asserts the permission behind every
route decorator — for the upload it does so **before** the opaque key is
generated and before a byte reaches storage, and the suite asserts that a denial
leaves storage untouched.

## Routes

All routes are private, unprefixed (`/imports`, per DEC-002) and tenant-scoped
from the request context. There is no `PATCH`, no `PUT`, no `DELETE` and no
route that accepts a state.

| Route                       | Permission     | Notes                                                                                            |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `POST /imports`             | `imports.run`  | `multipart/form-data` with `entity` and one file; returns `{ importId, state }` and nothing else |
| `POST /imports/:id/preview` | `imports.run`  | `202` with `{ importId, state: "PREVIEWING" }`; queues the preview, moves nothing                |
| `GET /imports`              | `imports.read` | the tenant's imports, newest first, `?limit=` bounded (default 50, max 100)                      |
| `GET /imports/:id`          | `imports.read` | one import with its counters; a foreign id is the byte-equivalent `404`                          |

The preview trigger REFUSES an import that is not `UPLOADED` with the same
stable `409` every other refused transition uses, and it does so BEFORE the
enqueue: work the state machine would certainly reject must not occupy the
queue. It also refuses a foreign or unknown id with the shared `404`, and
`imports.run` guards it because it is the command that decides what an operator
is about to commit.

The upload response is deliberately two fields. The import is asynchronous by
decision, so the honest answer to an upload is "accepted, here is what to watch"
— and the storage key is not part of it.

`?limit=` is REFUSED above the ceiling rather than truncated ([[TD-026]]): a
silently shortened page is a page that lies about what exists.

## What this slice does not do

- **The commit** — [[IMP-003]]. The machine's `COMMITTING` phase exists with no
  work behind it.
- **A patient preview** — [[IMP-002]] ships the customer column map only. The
  worker REFUSES a `PATIENT` import (logs it, writes nothing) rather than
  failing it: `FAILED` is terminal, so a refusal that wrote it would strand the
  import the day the patient map lands. The row stays `UPLOADED`.
- **XLSX** — refused by name ([[DEC-068]], [[TD-057]]).
- **Any UI** — [[IMP-005]] owns the polling surface.
- **A platform-wide TTL scheduler** — the sweep method and its batch bound are
  here; the driver is a worker concern.

## Known limitations

- The artifact's retention has no approved policy behind it yet ([[TD-058]]);
  the deletion rule above is the interim.
- The TTL sweep is tenant-scoped and unscheduled, so an idle tenant's artefacts
  are removed only once something runs the sweep for that tenant.
- The per-row outcome is written by the preview ([[IMP-002]]) but not yet
  served; [[IMP-004]] exposes it, and its redacted projection is pinned here so
  the no-personal-data rule is asserted now rather than discovered later.
- **A preview interrupted by a process death leaves the row `PREVIEWING`** with
  no writer. Nothing in this slice recovers it; the TTL sweep (`EXPIRED`) is the
  operator's route until a recovery pass exists.
- The duplicate prefetch asks about every candidate value in the file, so a very
  large file costs one round trip per 500 values. It is bounded in memory and
  parameter count, not in wall-clock time.
- `startPreview` on the service is now unused by the HTTP surface (the worker's
  claim performs the transition). It is kept because it is the addressed form of
  the transition, and removing a command from the machine is a change to the
  machine.
