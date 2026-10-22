---
id: DEC-067
type: decision
title: EPIC-18 owns the entry path for the due date it introduced, and only that
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-18"
  - "EPIC-06"
related_decisions:
  - "DEC-065"
  - "DEC-062"
related_stories:
  - "REP-006"
  - "REP-010"
  - "REP-008"
prd_change_required: false
---

# DEC-067 — The clinical entry surface: narrow, two kinds, and owned by this epic

## Context

[[DEC-065]] made PRD §31's "upcoming/overdue vaccines" and "upcoming deworming"
computable by adding a nullable `next_due_at` to `clinical_vaccination` and
`clinical_deworming`, entered by staff, because the veterinarian knows the
booster interval and the system must not guess it.

[[REP-001]] delivered the column and the API contract. It could not deliver the
entry surface, because **there was no surface to add a field to**:
`apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` handles
encounters only, and the five specialized record kinds are API-only on the staff
surface. That finding is [[TD-055]].

The consequence is unambiguous: the two due reports [[REP-006]] ships are empty
for every tenant, and the only way to populate them is a direct API call that no
staff role makes.

Three facts changed the cost estimate, and they were verified rather than
assumed:

```text
already exists, unused   apps/web/src/app/api/clinical/[[...path]]/route.ts
                         allowlists all five kinds with GET/POST and PUT on :id
already exists, granted  vet.clinical.create / update / read in PERMISSION_SEEDS
                         and in ROLE_PERMISSION_MATRIX
missing                  apps/web/.../patients/[id]/clinical-api.ts has only the
                         five ENCOUNTER functions; no UI section
```

So the proxy is written, the permissions are seeded, and neither needs touching.
What is missing is a client module and a form.

## Question

Where does the staff entry surface for `next_due_at` live, and how much of
[[TD-055]] does this epic take on?

## Options

### Option A — A narrow Story of its own, two kinds, before the UI Story (accepted)

[[REP-010]] owns exactly `vaccinations` and `deworming`: list, create, and
correct (including clearing the due date with an explicit `null`), reusing the
existing proxy and the existing permissions. [[TD-055]] narrows from five kinds
to three and stays open.

### Option B — Fold it into [[REP-008]]

The same code inside the Story already carrying the dashboard, the reports
workspace and the e2e lane. One Story fewer, and one commit that mixes
"reporting surfaces" with "clinical record entry" — two concerns, two review
questions, one revert boundary.

### Option C — Close [[TD-055]] entirely: all five kinds, full CRUD

Treatments, studies and weights have different shapes (dose, study type, weight
plus unit), none of them is read by any PRD §31 report, and together they are a
UI epic hung off the closure of a reporting epic.

### Option D — Leave it out

Ship the two due reports permanently empty, with an empty state that explains
they are empty and offers no way to change that.

Rejected by the maintainer, on the same reasoning that already rejected
deferring the two reports: a surface nobody can feed is not a delivered feature.

## Decision

Accepted by the maintainer on 2026-10-19.

**[[REP-010]] is a Story of this epic, scoped to vaccinations and deworming,
with create and correct, and it lands BEFORE [[REP-008]].**

The boundary argument, stated because it is what keeps this in scope rather than
creep: this is **not** the clinical record module and it does not reopen
[[EPIC-06]]. It is the entry path for a field **this epic introduced**. DEC-065
created the need to fill `next_due_at`; an epic that creates a field and ships
the report that reads it owns the smallest path that can fill it. The other
three record kinds are not read by anything this epic delivers, so they stay
outside it.

**Create AND correct, not create only.** The API already accepts an explicit
`null` to clear a wrong due date, and REP-001 added that deliberately. A
create-only form would reintroduce, in the UI, exactly the defect the API was
fixed to avoid.

**Ordering is part of the decision.** [[REP-010]] lands before [[REP-008]],
because REP-008's empty state links to this surface and would otherwise link to
a page that does not exist.

## Consequences

### Product

A tenant can record a vaccination with its due date and correct it. The two due
reports stop being permanently empty. Treatments, studies and weights remain
API-only, which is a real and named gap ([[TD-055]]), not a silent one.

### Architecture

No new module, no new proxy route, no new permission, no new dependency. One
client module and one UI section inside the existing patient workspace.

### Database/API

**Nothing.** The API, its validation and its permissions already exist and are
already tested. This is the first story in the epic with no backend change,
which is precisely why it is cheap.

### Delivery

[[REP-010]] before [[REP-008]]. [[TD-055]] is updated from five kinds to three
and stays `open`.

## PRD Update

No PRD change. PRD §31 is unchanged; this decision is about who owns the input
its reports depend on.
