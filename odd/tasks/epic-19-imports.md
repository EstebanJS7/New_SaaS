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
- [ ] **WU-A — [[IMP-001]] the import aggregate, the artefact and the
      permissions.**
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
