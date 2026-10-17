---
id: NOTIF-005
type: story
title: Epic closure and evidence
epic: EPIC-17
status: planned
priority: medium
depends_on:
  - NOTIF-001
  - NOTIF-002
  - NOTIF-003
  - NOTIF-004
prd_sections:
  - "24"
  - "34"
  - "36"
---

# NOTIF-005 — Epic closure and evidence

## Objective

Close EPIC-17 against evidence: the module's implemented-behavior document, the
CI and live evidence including a **pending** live-delivery result, the
changelog, the roadmap, and a triage of every advisory and debt item the epic
raised.

The FISC-014 precedent is the shape: a closure that records what was **not**
proven as pending and by name, rather than letting `done` imply more than it
means.

## Context

- EPIC-17's `done` means **implementation closure**, never production readiness.
  [[EPIC-20]] Production Hardening remains, and the production adapters stay
  unproven until an operator supplies credentials ([[DEC-061]]).
- [[TD-004]] is blocked on this epic's email delivery. The closure checks
  whether it is now unblocked and says so either way, without implementing it
  here.
- `DOCUMENTATION-RULES.md` requires the module documentation to describe
  implemented behavior, and `ENGINEERING-RULES.md`'s Definition of Done includes
  documentation as a gate, not an afterthought.
- The epic's own findings will have produced advisories. They are **triaged, not
  resolved by the closure**.

## In Scope

- `docs/05-modules/Notifications.md` — the implemented-behavior document.
- The module index (`docs/05-modules/README.md`).
- `docs/10-qa/CI-EVIDENCE.md` — the epic's evidence block, including the live
  delivery run recorded **pending and by name** if it was not performed.
- `docs/09-releases/CHANGELOG.md`.
- The ROADMAP row and the epic file's status and closure record.
- The epic's acceptance criteria checked **one by one** against a receipt, with
  a recorded note for any criterion answered by a limitation.
- The advisory and technical-debt triage: each item marked with its status and,
  where triaged rather than resolved, named.
- Verification that EPIC-07's and EPIC-16's closed decisions were not reopened:
  the boundary debt stayed emitter-only ([[DEC-059]]).
- Confirmation that no thirteenth feature code was introduced ([[DEC-058]]) and
  that every new dependency has an accepted ADR ([[DEC-061]]).

## Out of Scope

- Implementing [[TD-004]]. The closure records whether it is unblocked.
- New behavior of any kind. A closure Story that changes behavior is not a
  closure.
- Resolving this epic's advisories.
- Marking the live delivery run as performed when no operator credentials were
  supplied.
- EPIC-18 scope and any other epic.

## Acceptance Criteria

- [ ] `docs/05-modules/Notifications.md` describes the implemented aggregate,
      the lifecycle, the dedupe semantics, the channel boundary, the settings
      namespace, the emitters, the read surface and the permission family — all
      as implemented, with its limitations stated.
- [ ] The limitations are stated in the module doc: the unproven live run, the
      absent re-drive, the `AppointmentRescheduled` catalog gap, and the
      lost-enqueue window.
- [ ] The epic's acceptance criteria are each checked against a specific receipt
      or marked as answered by a named limitation, **with none silently
      dropped**.
- [ ] The evidence block names the CI runs and the local gates, and records the
      live delivery run as **pending** with the missing operator inputs named
      (an SMTP or provider key, a WhatsApp Business account) — never implied.
- [ ] The changelog entry describes what shipped, in the project's existing
      changelog style.
- [ ] The ROADMAP row moves to `done` (or records the epic as blocked), and the
      epic file's status, `updated` and closure record match.
- [ ] Every advisory is recorded with its coordinate and a reading explicitly
      marked as a reading, in the absence of published finding text — the
      `review-last-event-closure/v1` precedent from EPIC-16.
- [ ] Every technical-debt item raised during the epic has a status and an owner
      decision; none is left untriaged.
- [ ] [[TD-004]]'s entry is updated to reflect whether email delivery now
      exists, and the item stays `open` unless it is actually implemented.
- [ ] A repository search confirms the three emitters have exactly the
      publishers [[DEC-059]] names, that no notification handler holds a
      database transaction across a provider call, and that no contact datum
      reaches a log, a job payload or a response.
- [ ] The feature-code catalog still has exactly twelve codes ([[DEC-058]]).
- [ ] Every new dependency has an accepted ADR ([[DEC-061]]).
- [ ] Tenant isolation is enforced when applicable. Evidence: the live
      PostgreSQL block's case count recorded in the evidence file.
- [ ] Backend authorization is enforced when applicable. Evidence: the
      route-contract probe's inventory, including the new settings namespace and
      read route.
- [ ] Required loading/error/empty/success UX exists. Evidence: the surface's
      state cases recorded at [[NOTIF-004]].
- [ ] Required audit exists. Evidence: the audit decision recorded at
      [[NOTIF-001]] and [[NOTIF-003]], with the appointment and fiscal audit
      rows proven unchanged.
- [ ] Tests required by the Story pass.

## Domain Invariants

- A closure changes no behavior; it records what exists.
- `done` never implies production readiness for the unproven adapters.

## API

### Added

```text
None yet
```

### Changed

```text
None yet
```

## Database

### Migration

```text
None yet
```

### Models/Tables

- None. The closure adds no schema.

## UI

- None in this Story.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- None. A closure Story adds documentation and evidence, and if it needs a test
  to prove a claim, that is a sign the claim belongs to an earlier Story.

## Known Limitations

- The closure cannot make the live provider run happen; it can only record its
  absence honestly.

## Technical Debt

- The epic's debt is triaged here: each item marked `open`, `accepted`,
  `scheduled` or `resolved`, and each fix that lands during the epic named.

## Decisions / ADRs

- No new ADR. The closure records the ADRs the epic produced.

## Files / Modules

- `docs/05-modules/Notifications.md` (new) and `docs/05-modules/README.md`.
- `docs/10-qa/CI-EVIDENCE.md`.
- `docs/09-releases/CHANGELOG.md`.
- `docs/01-roadmap/ROADMAP.md` and `docs/01-roadmap/EPIC-17-Notifications.md`.
- `docs/08-tech-debt/TD-004-password-reset-deferred.md`.

## Completion Notes

_Status must remain non-done until all required gates pass._
