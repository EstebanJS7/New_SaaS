---
id: NOTIF-005
type: story
title: Epic closure and evidence
epic: EPIC-17
status: done
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

- [x] `docs/05-modules/Notifications.md` describes the implemented aggregate,
      the lifecycle, the dedupe semantics, the channel boundary, the settings
      namespace, the emitters, the read surface and the permission family — all
      as implemented, with its limitations stated.
- [x] The limitations are stated in the module doc: the unproven live run, the
      absent re-drive, the `AppointmentRescheduled` catalog gap, and the
      lost-enqueue window.
- [x] The epic's acceptance criteria are each checked against a specific receipt
      or marked as answered by a named limitation, **with none silently
      dropped**.
- [x] The evidence block names the CI runs and the local gates, and records the
      live delivery run as **pending** with the missing operator inputs named
      (an SMTP or provider key, a WhatsApp Business account) — never implied.
- [x] The changelog entry describes what shipped, in the project's existing
      changelog style.
- [x] The ROADMAP row moves to `done` (or records the epic as blocked), and the
      epic file's status, `updated` and closure record match.
- [x] Every advisory is recorded with its coordinate and a reading explicitly
      marked as a reading, in the absence of published finding text — the
      `review-last-event-closure/v1` precedent from EPIC-16.
- [x] Every technical-debt item raised during the epic has a status and an owner
      decision; none is left untriaged.
- [x] [[TD-004]]'s entry is updated to reflect whether email delivery now
      exists, and the item stays `open` unless it is actually implemented.
- [x] A repository search confirms the three emitters have exactly the
      publishers [[DEC-059]] names, that no notification handler holds a
      database transaction across a provider call, and that no contact datum
      reaches a log, a job payload or a response.
- [x] The feature-code catalog still has exactly twelve codes ([[DEC-058]]).
- [x] Every new dependency has an accepted ADR ([[DEC-061]]).
- [x] Tenant isolation is enforced when applicable. Evidence: the live
      PostgreSQL block's case count recorded in the evidence file.
- [x] Backend authorization is enforced when applicable. Evidence: the
      route-contract probe's inventory, including the new settings namespace and
      read route.
- [x] Required loading/error/empty/success UX exists. Evidence: the surface's
      state cases recorded at [[NOTIF-004]].
- [x] Required audit exists. Evidence: the audit decision recorded at
      [[NOTIF-001]] and [[NOTIF-003]], with the appointment and fiscal audit
      rows proven unchanged.
- [x] Tests required by the Story pass.

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

The epic is closed and **no behavior changed** — this Story is the record, not a
change: the diff is documentation only.

- **`docs/05-modules/Notifications.md`** — the module document, written from the
  implemented behavior: the aggregate and its four SQL guards, the lifecycle,
  the dedupe semantics, the queue with its two producers, the fail-closed
  channel boundary, the settings namespace and the value-level entitlement gate,
  the three emitters with the rules a reader should hold them to, the content
  builder and its gate, the read surface, the class table, and the limitations.
- **`docs/05-modules/README.md`** — the index row.
- **`docs/10-qa/CI-EVIDENCE.md`** — the epic's evidence block, whose first fact
  is the one a reader would otherwise assume wrongly: **there is no CI receipt,
  because no branch of this epic was pushed**. It lists the local gates, the
  fresh-PostgreSQL migration pass, and the live delivery run **pending by name**
  with the four missing operator inputs and who provides each.
- **`docs/09-releases/CHANGELOG.md`** — the entry, in the existing style.
- **`docs/01-roadmap/ROADMAP.md`** — the row to `done` plus the closure
  narrative.
- **`docs/01-roadmap/EPIC-17-Notifications.md`** — status, the acceptance
  criteria each mapped to a receipt, the closure searches, and the debt triage.
- **[[TD-004]]** — updated: **unblocked in principle**, still `open` by
  decision, with the two things the resolving Story must build named (a new
  source type and a staff recipient reader) so the next unit does not find them
  late.

### The claims that needed a search rather than a memory

The closure criteria ask for confirmation of four things that no test asserts,
so each was checked by searching the tree and the result is recorded in the epic
file: the three emitters have exactly the publishers [[DEC-059]] names and no
other non-test `publish()` call exists; the delivery handler's send is outside
every transaction; the words "phone" and "contactValue" appear in the
notification paths only inside comments; and the feature-code catalog still has
exactly twelve entries.

### What was NOT done, on purpose

- **The live delivery run**: no credentials exist. Recorded pending, named, with
  its blockers — never implied.
- **The advisories were not resolved**: this Story's own scope excludes it.
  [[TD-045]], [[TD-046]] and [[TD-047]] are triaged with owner decisions
  instead, and [[TD-046]] and [[TD-047]] are decisions the maintainer took
  rather than deferred.
- **No behavior was changed**, including no "while I was here" cleanup: a
  closure Story that changes behavior is not a closure.

## Verification

```text
pnpm format-check                   clean
pnpm lint                           22/22 packages
pnpm typecheck                      22/22 packages
pnpm build                          13/13 packages
@newsaas/api test                   1269 passed
@newsaas/web test                   1100 passed
@newsaas/worker test                226 passed
@newsaas/notifications test          81 passed
@newsaas/database test              512 passed
```

The closure tree's diff is documentation only, so the gates above are the same
code gates [[NOTIF-003]] and [[NOTIF-004]] recorded, re-run on the merged tree.
The epic's full evidence block, including the pending live run, is in
`docs/10-qa/CI-EVIDENCE.md`.

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

**Reviewed, and the provider itself decided this needed no reviewers.**
`review-cb330294ce206b4d` STARTed and closed `approved` on the spot with
`risk_tier: low`, **zero selected lenses**, `lenses_required: false` and the
reason code `non_executable_only` — 10 paths, 977 changed lines, every one of
them documentation — and its acknowledgement burned the authority. The same
closure WU-A's docs-only unit received, and the correct outcome for a diff that
is entirely inert text. No findings, so no advisories and no readings to mark.

**EPIC-17 is `done`, and the sentence that matters is the one about what `done`
means.** Every Story is implemented, reviewed and validated; every acceptance
criterion is mapped to a receipt or to a named limitation; the gates are green;
and **nothing has been delivered to a real recipient**, because no credentials
exist in this repository. The live run is recorded pending by name, and the
coverage is the deterministic fake's.

It also has **no CI receipt**: no branch was pushed. That is a deliberate
consequence of the repository's own rule, and it is recorded rather than papered
over, because an evidence file that implies a green pipeline it never had is
worse than one that says it has none.

**The epic's most useful artifact may be its debt table.** Eight items were
raised, six resolved, and the two that stayed open carry a decision: [[TD-046]]
is a scope decision the maintainer took (a summary is the right shape, and a
second home for the same truth could disagree with the first), and [[TD-047]] is
non-blocking by the review's own statement. [[TD-004]] moves from blocked to
unblocked-in-principle and stays open, because it is a feature rather than a
chore.
