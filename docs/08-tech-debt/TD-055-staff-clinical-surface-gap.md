---
id: TD-055
type: tech-debt
title:
  The staff clinical surface is encounters only — five record kinds are API-only
status: open
severity: medium
owner: product
related_epics:
  - EPIC-18
  - EPIC-06
related_stories:
  - REP-001
  - REP-006
related_decisions:
  - "DEC-065"
created: 2026-10-19
updated: 2026-10-19
---

# TD-055 — five clinical record kinds have no staff write surface

## What was found

Discovered while implementing [[REP-001]], which had assumed a vaccination form
existed to extend. It does not.

`apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` (693 lines)
handles **encounters** only: create a draft, close it, amend it. There is no
staff form for any of the five specialized clinical record kinds that
`apps/api/src/clinical/clinical.records.controller.ts` exposes and `apps/api`
fully implements:

```text
kind          API routes                                                      staff UI
treatments    GET|POST /patients/:patientId/clinical/treatments               none
vaccinations  GET|POST /patients/:patientId/clinical/vaccinations             none
deworming     GET|POST /patients/:patientId/clinical/deworming                none
studies       GET|POST /patients/:patientId/clinical/studies                  none
weights       GET|POST /patients/:patientId/clinical/weights                  none
```

Three surfaces exist for them and none is a staff write path:

- the API, complete with validation, audit and permissions;
- a web BFF proxy, `apps/web/src/app/api/clinical/[[...path]]/route.ts`, so the
  browser _can_ reach them;
- the **portal**, read-only (`portal-pet-detail.tsx` renders what is there).

So a tenant can display a patient's vaccinations to its owner but has no screen
on which to record one. The capability is reachable only by calling the API
directly, which no staff role does.

## Why this matters to [[EPIC-18]] specifically

PRD §31 asks for "upcoming/overdue vaccines" and "upcoming deworming".
[[DEC-065]] made those computable by adding a nullable `next_due_at` to both
tables, entered by staff — because the veterinarian knows the booster interval
and the system must not guess it.

[[REP-001]] delivered the column and the API contract. **It could not deliver
the entry surface, because there was no surface to add a field to.** That was
recorded rather than papered over: creating a whole clinical-record form inside
a "prerequisites" Story would have been a silent scope expansion across two
epics.

The consequence is stated plainly: until this item lands, both due reports are
empty for every tenant, and the only way to populate them is a direct API call.
That is the same limitation the vaccination capability already had; the report
inherits it rather than creating it.

## What a fix would need

- A staff surface for the five record kinds under the patient workspace, reusing
  the BFF proxy that already exists.
- A decision on whether these records are edited after creation. The API exposes
  `PATCH`; the UI has no `PATCH` story. [[REP-001]] made `next_due_at` clearable
  by an explicit `null`, which presumes editing is eventually possible.
- Permission and empty/error states consistent with the encounter workspace.
- Playwright coverage in `apps/e2e`, which the workspace has none of today.

## Why it is not simply "EPIC-06 forgot"

[[EPIC-06]] closed on its own acceptance criteria, which covered the encounter
aggregate and its invariants; the specialized records were delivered as API
capability. Nothing in that epic's scope said otherwise, and this item does not
reopen it. It records that the _combined_ state of the product ships a
displayable but unrecordable clinical history, which is a product gap rather
than a defect in either epic.

## Pointers

- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` — the
  surface that stops at encounters.
- `apps/api/src/clinical/clinical.records.controller.ts` — the five route groups
  and their permissions.
- `apps/web/src/app/api/clinical/[[...path]]/route.ts` — the BFF proxy that
  already forwards them.
- [[DEC-065]] — the due date this item is the entry path for.
- [[REP-006]] — the veterinary reports that depend on it.
