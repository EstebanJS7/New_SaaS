---
id: EPIC-19
type: epic
title: Imports
status: done
priority: medium
depends_on:
  - EPIC-04
  - EPIC-05
prd_sections:
  - "32"
created: 2026-10-19
updated: 2026-10-19
---

# EPIC-19 — Imports

## Objective

Let a tenant bring its own list in: customers and patients from a spreadsheet,
with the validation, preview and result summary PRD §32 asks for, run
asynchronously and summarised honestly row by row.

## What the exploration found before writing anything

Every claim below was verified against the code, not assumed from the PRD.

```text
does not exist   any CSV or spreadsheet parser, any import route, any import
                 table, any `files` module (PRD §5 lists the domain; the
                 directory does not exist), any bulk create path anywhere
does exist       `packages/storage` with a StoragePort (put/get/delete/signedUrl)
                 and S3 + in-memory drivers, a @Global() StorageModule
                 `apps/worker` with real BullMQ consumers
                 `POST /patients` ALREADY accepts `primaryGuardianCustomerId` and
                 creates patient + guardian + both audit rows in ONE transaction
                 `createCustomerBody` and `createPatientBody` exported zod schemas
does not exist   ANY natural unique key on `customer`: the only unique index is
                 `(tenant_id, id)`, and `customer_contact` has none either
```

Two of those facts shaped the whole design:

- **The guardian problem is already solved.** [[DEC-070]] decided a patient
  import references an existing customer; the API's create contract already
  takes exactly that (`primaryGuardianCustomerId`, required unless the patient
  is created inactive) and satisfies the deferred
  `patient_exactly_one_primary_guardian` trigger inside its own transaction. The
  import therefore calls the existing service instead of inventing a second
  guardian path.
- **Duplicate detection cannot be a constraint.** With no natural key on
  `customer`, matching "an existing customer" is a heuristic over document
  number or contact value. [[DEC-069]] therefore makes the import create-only
  and reports a suspected duplicate as a **warning attached to the row**, never
  as a guarantee and never as an update.

## Scope

- One CSV format per entity: **customers** and **patients**. XLSX is deferred by
  [[DEC-068]] with a named tech debt, because the PRD's own line is one sentence
  and the expensive half of this epic is the validation/preview/summary
  machinery, not the parser.
- An import aggregate: the uploaded artefact, its state machine, its per-row
  outcome and its summary.
- **Upload once** ([[DEC-072]]): the file lands in `packages/storage` and the
  preview and the commit both read that same artefact, so the commit confirms
  exactly what the preview showed.
- A preview pass that validates every row against the same zod schema the single
  create endpoint uses, and reports what would happen.
- A commit pass that **commits the valid rows and reports the rest**
  ([[DEC-071]]), producing a per-row result summary.
- **Always asynchronous** ([[DEC-072]]): every upload goes to the queue, using
  the worker and BullMQ the repository already runs. No threshold to tune and no
  second synchronous path to keep in agreement.
- The `imports.*` permission family. **No feature-code gate** ([[DEC-072]]),
  following [[DEC-058]] and [[DEC-062]]: `imports` is not among PRD §10's twelve
  and a thirteenth code has been refused twice.
- The staff surface: upload, preview, progress and result summary, with every
  state rendered.
- Playwright specs in `apps/e2e/specs/` for the surface.

## Out of Scope

- **XLSX** ([[DEC-068]], [[TD-057]]).
- **Updating existing records.** The import is create-only ([[DEC-069]]). A
  tenant that wants corrections edits them, or imports into an empty dataset.
- **Creating customers implicitly from a patients file.** [[DEC-070]] makes an
  unresolved guardian reference a row error.
- **Any other entity.** Suppliers, catalog items, purchases and invoices are not
  in PRD §32 and are not here.
- **Rollback of a partially committed import.** Every committed row is a normal
  record with its own audit trail; undoing it is the ordinary deactivate path,
  not an import feature. Doing otherwise would mean an import could delete
  records the tenant has since used, which contradicts the reversals policy.
- **A generic import framework.** Two entities, two column maps, one pipeline. A
  third entity would be a Story, not a configuration.

## Acceptance Criteria

- [x] A customer CSV and a patient CSV can be uploaded, previewed and committed
      end to end, asynchronously, through the staff surface.
- [x] Every row is validated with the SAME zod schema `POST /customers` and
      `POST /patients` use; the import does not carry a second copy of any rule.
- [x] A patient row whose guardian reference does not resolve is a row error,
      never a silently created customer.
- [x] The commit is partial by design: valid rows land, invalid rows are
      reported with their row number and reason, and the summary states both
      counts.
- [x] The commit reads the SAME stored artefact the preview read, so a changed
      file cannot be committed under an unchanged preview.
- [x] Suspected duplicates are reported as warnings from a documented heuristic,
      never as a guarantee and never as an update.
- [x] Every import row creates its own audit trail, so a bulk import is as
      traceable as the equivalent manual entry.
- [x] `imports.run` and `imports.read` exist in `PERMISSION_SEEDS`, mapped to
      roles, enforced server-side and pinned in the RBAC route-contract probe.
- [x] Tenant isolation on every import read and write; a foreign import id is a
      `404`.
- [x] The staff surface renders upload, preview, progress, result summary and
      the failure states, using semantic branding tokens only.
- [x] Playwright specs cover one import end to end.
- [x] Documentation: `docs/05-modules/Imports.md`, the Stories, the Decisions,
      the tech debt, the changelog and the roadmap row.
- [x] Format, lint, typecheck, build and the full test set are green.

## Stories

- [[IMP-001]] — The import aggregate, the artefact and the permissions.
- [[IMP-001A]] — The shared create contracts (found late, [[DEC-073]]).
- [[IMP-002]] — The CSV pipeline and the customer preview.
- [[IMP-003]] — The customer commit.
- [[IMP-004]] — The patient preview and commit.
- [[IMP-005]] — The staff surface.
- [[IMP-006]] — The epic closure and evidence.

## Dependencies

[[EPIC-04]] Customers and [[EPIC-05]] Patients are the two entities imported,
and both are `done`. `packages/storage`, `apps/worker` and the BullMQ setup
already exist and are reused rather than extended.

The epic crosses **two already-`done` epics' write paths** only by calling their
public service methods — it adds no column to `customer`, `patient` or
`patient_guardian` and changes neither contract.

## Exit Criteria

- [x] Lint/typecheck/tests/build required for the Epic are green.
- [x] Documentation is current.
- [x] `docs/10-qa/CI-EVIDENCE.md` carries the closure block with the CI run id.
- [x] The roadmap row reads `done`, with the evidence-based closure note.
- [x] Every deferred item is a named Tech Debt, not a silent gap.

## Closure record

Closed on 2026-10-22, merged-ready as **PR #146** with the required checks green
on run
[`39774118687`](https://github.com/EstebanJS7/New_SaaS/actions/runs/39774118687):

```text
Database migrations              pass
Lint, Typecheck, Test, Build     pass
DTE XSD validation               pass
Browser end-to-end               pass   22 passed, 1 skipped
```

This closure has a **real CI receipt**, unlike [[EPIC-18]]'s local one: the
epic's own surface had to run in a browser before it could claim anything, and
getting that lane green took four iterations that each produced a finding rather
than a selector fix.

```text
api 1760 | web 1343 | imports 132 | worker 282 | customers 9 | patients 8 | database 550
turbo 23 -> 29 tasks (three new packages)
```

**What `done` does not mean**, stated because this epic closes with three named
gaps:

- **XLSX is not implemented.** PRD §32 says "CSV/XLSX"; the MVP ships CSV and
  [[DEC-068]] records the deviation rather than editing the PRD ([[TD-057]]).
- **The artefact's retention has no approved policy behind it** ([[TD-058]]),
  and the worker's terminal path does not delete the file — the API commands and
  the TTL sweep do.
- **The browser lane cannot run an import end to end** ([[TD-060]]): there is no
  shared object storage, so the full-flow test exists and skips with the reason
  named while a second test proves the half the lane can reach.
- [[EPIC-20]] Production Hardening remains.

## Decisions / ADRs

- [[DEC-068]] — CSV only in the MVP; XLSX deferred with a named tech debt.
- [[DEC-069]] — Create-only; duplicate reporting is a heuristic, not a
  constraint.
- [[DEC-070]] — A patient import references an existing customer as its
  guardian.
- [[DEC-071]] — Partial success with a per-row summary.
- [[DEC-072]] — Always asynchronous, upload once, ungated by feature code.
- [[DEC-073]] — The customer and patient create contracts move to packages, so
  the worker validates with the same rules the API enforces.

## Technical Debt

- [[TD-057]] — XLSX, deferred by [[DEC-068]].
