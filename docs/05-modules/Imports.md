---
type: module
status: implemented
epic: EPIC-19
updated: 2026-10-19
---

# Imports

The imports module gives a bulk import a durable identity: which tenant, which
entity, which stored file, what state, and — from [[DEC-071]] — a per-row
outcome that survives the request that produced it. It is the foundation
[[IMP-002]] onwards build on: this slice stores the artefact, owns the lifecycle
and seeds the permissions, and it deliberately contains **no parsing, no preview
logic and no commit logic**.

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

| Command           | From                       | To           | Audit action        |
| ----------------- | -------------------------- | ------------ | ------------------- |
| —                 | (row created)              | `UPLOADED`   | `import.uploaded`   |
| `startPreview`    | `UPLOADED`                 | `PREVIEWING` | `import.previewing` |
| `completePreview` | `PREVIEWING`               | `PREVIEWED`  | `import.previewed`  |
| `startCommit`     | `PREVIEWED`                | `COMMITTING` | `import.committing` |
| `completeCommit`  | `COMMITTING`               | `COMMITTED`  | `import.committed`  |
| `fail`            | `PREVIEWING`, `COMMITTING` | `FAILED`     | `import.failed`     |
| `expire`          | any non-terminal           | `EXPIRED`    | `import.expired`    |

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

| Route              | Permission     | Notes                                                                                            |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------ |
| `POST /imports`    | `imports.run`  | `multipart/form-data` with `entity` and one file; returns `{ importId, state }` and nothing else |
| `GET /imports`     | `imports.read` | the tenant's imports, newest first, `?limit=` bounded (default 50, max 100)                      |
| `GET /imports/:id` | `imports.read` | one import with its counters; a foreign id is the byte-equivalent `404`                          |

The upload response is deliberately two fields. The import is asynchronous by
decision, so the honest answer to an upload is "accepted, here is what to watch"
— and the storage key is not part of it.

`?limit=` is REFUSED above the ceiling rather than truncated ([[TD-026]]): a
silently shortened page is a page that lies about what exists.

## What this slice does not do

- **Parsing, validation, preview and commit** — [[IMP-002]] onwards. The
  machine's `PREVIEWING` and `COMMITTING` phases exist with no work behind them.
- **XLSX** — refused by name ([[DEC-068]], [[TD-057]]).
- **Any UI** — [[IMP-005]] owns the polling surface.
- **A platform-wide TTL scheduler** — the sweep method and its batch bound are
  here; the driver is a worker concern.

## Known limitations

- The artifact's retention has no approved policy behind it yet ([[TD-058]]);
  the deletion rule above is the interim.
- The TTL sweep is tenant-scoped and unscheduled, so an idle tenant's artefacts
  are removed only once something runs the sweep for that tenant.
- The per-row outcome is stored but not yet written or served; [[IMP-003]] and
  [[IMP-004]] produce it, and its redacted projection is pinned here so the
  no-personal-data rule is asserted now rather than discovered later.
