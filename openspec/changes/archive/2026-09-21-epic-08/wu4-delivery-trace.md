# EPIC-08 WU4 Historical Delivery Trace

> **Historical, non-authoritative.** This file preserves slice-level delivery
> detail that lived only in the local, untracked ODD task
> `odd/tasks/epic-08-portal-wu4.md`, retired by the EPIC-08 housekeeping work.
> It is not an active change, not a spec, and not an acceptance record.
> Authoritative EPIC-08 state is the archived change itself (`tasks.md`,
> `apply-progress.md`, `archive-report.md`), the standing specs in
> `openspec/specs/`, and the current roadmap in `docs/01-roadmap/ROADMAP.md`.
> Where this trace and those sources disagree, they win.

TDD mode for the source work and for this preservation: disabled
(`openspec/config.yaml` → `strict_tdd: false`). No RED/GREEN proof is claimed.

## What this trace adds

The archived change records WU4 at slice-family level (PRs #29–#52, closed at
`27bc04a`). The retired ODD file carried four things worth keeping:

1. the per-slice commit / PR / changed-line sequence;
2. the review-defect lessons that changed the code;
3. the mechanics that must stay true in the merged implementation;
4. the decisions taken when the user declined a question round.

## Planned status vs merged reality

The trace's own status lines are **obsolete planning state**, never completion
evidence. Merged reality below is verified against `main` history.

| Slice as written in the trace | Trace-time status                              | Merged reality (verified)                                                                                   |
| ----------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| WU4A1 support                 | done                                           | `07c1090`, PR #29, merged via `d94f803`                                                                     |
| WU4A2 booking create          | done                                           | `683a957`, PR #30, merged via `5ddeb46`                                                                     |
| WU4B staff approve/reject     | "implemented, awaiting landing"                | `8abd23d` + `8807ff7` + `ff81e84`/`78da3c9`, PRs #31–#33, merged via `7a4e7b7`/`e9fafa4`/`7ccd1c1`          |
| WU4C profile self-service     | done                                           | `15e23ad` + `7a6b795`, PRs #34–#35, merged via `89fb278`/`60b3bd2`                                          |
| WU4D slice A proxy writes     | done, PR #37                                   | `71ecfbd`, merged via `0c0e061`                                                                             |
| WU4D slices B–D               | pending; estimates 550–700 / 400–550 / 300–450 | Obsolete: the remaining WU4D work landed before epic closure. Estimates were planning numbers, not actuals. |

One further trace-time statement is obsolete:

- "WU4B, WU4C, WU4D and WU5 remain" — all four merged; the EPIC-08 change closed
  at `27bc04a` (merge of PR #53), and `docs/01-roadmap/ROADMAP.md` now records
  EPIC-08 as `done`.

Not verifiable here: the retired trace also said GitHub tracker issue #18 was
still open. Whether and when that issue was closed is not recorded in this
repository's history, so this trace makes no claim either way. Treat the tracker
state as external evidence to check in GitHub.

### Beyond the trace: the merged WU4 tail

PRs #40–#52 completed WU4D after the trace was written: staff pending-request
agenda, availability proxy, portal pages, appointments, booking grid,
booking-request read and envelope, cancel/reschedule and slot picker (branch
names; merge commits `a5b5288` … `7fe08e8`). Verify content against archived
`tasks.md` phase 4 and `docs/05-modules/Portal.md`, not this file.

## Key WU4 mechanics that must stay true

- **One holder-ownership guard.** `portal-holder-scope.ts` defines the single
  predicate and the byte-equivalent `NOT_FOUND` used by reads and writes; the
  read service delegates instead of duplicating it (WU4A1, a pure move).
- **Booking create is additive.** A holder request persists
  `PortalBookingRequest(PENDING)` plus one co-committed `PORTAL` audit row
  (`portal_booking.requested`, target `portal_booking_request`, field names
  only). No overlap evaluation, no auto-confirmation, no appointment.
- **Approval promotes exactly one appointment.** Staff approve re-validates the
  guardian link, then creates one
  `Appointment(source=PORTAL, portalBookingRequestId=…)`; reject creates none.
  Staff own branch and professional assignment; the request row stays additive.
- **Idempotency shape.** A repeated approve returns the appointment already
  linked to the request. The service pre-check is the guard; the per-tenant
  unique on `appointment.portal_booking_request_id` is the backstop, because the
  in-memory fake simulates no Prisma `P2002`.
- **Revoked guardian link at approval is `CONFLICT`**, never a silent promotion.
  This closes the unlink race WU4A2's verification flagged.
- **Defense in depth at the boundary.** The controller keeps the `401`; the
  service re-asserts staff identity plus `scheduling.appointment.manage` so a
  direct non-staff caller gets `FORBIDDEN`.
- **Slot override.** When the requested slot is gone, the assignment body may
  carry the real slot. The request keeps the holder's times; the appointment
  carries the approved slot; audit records field names and a stable
  `slotOverridden` boolean, never scheduling values.
- **Atomic audit.** Every mutation passes the open `tx` to `AuditWriter.append`.
- **Profile upsert rules the schema does not give us.** `CustomerContact` has
  `isPrimary` but no partial unique index, so the boundary upserts the primary
  (else the most recently updated active row) and demotes the holder's other
  PHONE rows in one transaction. `CustomerAddress` has no primary column, so the
  most recently updated active address is updated and the rest are untouched.
- **Strict profile payload** rejects email, name, kind and tax id with `400`.
  The write route refuses `x-tenant-id` / `x-customer-id` while sibling read
  routes accept-and-ignore them (identity-hint divergence, accepted).
- **Proxy is method-aware.** Exactly the eight served (method, shape) pairs are
  allowed; unknown path keeps the `404` envelope, a known path with a disallowed
  method returns a uniform `405` with no `Allow` header.

Invariants that held for the WU4 slices above: no portal-side
confirm/cancel/reschedule status mutation; no `@RequirePermissions` on portal
routes; the deferred surface (`invoices`, `documents`, `files`, `notifications`,
`email`, `treatments`) stays `404`; no
`AppointmentConfirmed`/`AppointmentCancelled` event on the portal path.

**The cancel/reschedule part was trace-time scope, not a permanent rule.**
DEC-007 (accepted) covers holder cancellation and reschedule, and PRs #50–#52
delivered them (cancel/reschedule service, slot picker, cancel/reschedule UI).
What must still hold is the guardian-ownership check and the rule that nothing
already started is rescheduled; see DEC-007 and `docs/05-modules/Portal.md` for
current behavior.

## Review-defect lessons (WU4B)

1. **A second creation path silently skipped invariants (critical).** The first
   approval implementation created the active appointment while bypassing tenant
   anchors, availability/blocks and the advisory-lock overlap check that
   `createAppointment` has always enforced, so a portal appointment could
   overlap another. Fixed by extracting the shared sequence into
   `appointment-invariants.ts`, so staff create, reschedule and portal approval
   run identical invariants on one open transaction. Lesson: divergent creation
   paths are a correctness hole, not a style question.
2. **Concurrent repeat approval could return `409` instead of the winner.** The
   recovery path handled only `P2002`, while the race loser can also fail the
   overlap check (it takes the advisory lock after the winner commits) or the
   compare-and-set. Fixed by widening recovery to those outcomes while still
   requiring a linked appointment, so a genuine slot conflict stays `409`. Both
   new unit tests were proven revert-sensitive by reverting the predicate and
   watching them fail.
3. **A test-local harness patch stood in for a proper fake extension.** The
   `extendBookingRequestBoundary` shim was replaced by extending the shared
   in-memory harness, so the slice exercises the same harness as every suite.

Lessons carried from the split and landing mechanics:

- WU4A measured 942 changed lines, above the 800-line budget, and was split at
  commit time by **staging files**, not by rewriting content (WU4A1 240, WU4A2
  704).
- WU4B measured 2,415 lines and shipped as three stacked PRs (#31–#33). WU4B2
  landed at 906 lines, 13% over budget with 251 test lines; the alternative
  split would have separated a service from the tests proving its race recovery,
  which reviews worse. Disclosed in the PR body.
- Merging a stacked child with `--delete-branch` **auto-closes** the open child
  PR whose base was that branch, and reopening fails until the base ref exists
  again. Land without deleting, then delete merged branches once every slice is
  in.
- Attributed to the retired trace (not independently re-verified here): the
  chain PRs #19–#30 landed bottom-up as merge commits, each retargeted to `main`
  immediately before merging, so no PR ever showed a sibling's diff, and
  `5ddeb46` was the then-current green `main`. The merge commits for #29
  (`d94f803`) and #30 (`5ddeb46`) are verified; the rest of that claim is not.

## Decisions taken as agent calls (user declined the question round)

These were recorded as overridable:

1. **Booking UX** — date, time and fixed duration in the form, sent as
   `startAt`/`endAt`. No schedule picker, because the API evaluates no
   availability and has no service selection.
2. **Data fetching** — thin server page wrapping a client component with
   react-query plus a `portal-api.ts` module calling `/api/portal`, matching the
   staff convention; the session cookie stays the proxy's job.
3. **Missing guard test** — add the spec-required test that portal sources must
   not import staff navigation, mirroring `apps/web/src/styles/tokens.test.ts`.
4. **Route shapes** — `POST /portal/pets/:id/bookings` (the path WU3's
   deferred-404 test already encoded), `GET`/`PUT /portal/profile`, and
   `GET /booking-requests` plus `POST /booking-requests/:id/{approve,reject}`.
5. **`bookingRequiresApproval=false`** — advisory only; every request stays
   `PENDING` and requires staff approval. Auto-confirmation stayed out of scope.

## Gaps the scout found (trace-time state, several since resolved)

These were real at trace time. They are listed as history, not as current
limitations:

- **No portal read for the holder's own booking requests.** Create returned only
  the request id and only staff could list requests, so a booking page could not
  show status follow-up. **Resolved afterward:** PRs #46
  (`feat/epic-08-portal-bookings-read`) and #49
  (`feat/epic-08-portal-envelope-and-requests`) worked this area; confirm the
  merged behavior in the archived `tasks.md` and `docs/05-modules/Portal.md`.
- **Species/breed names unresolved** — pet reads returned ids only, so the UI
  could not resolve names. **Resolved afterward:** PR #61
  (`feat(portal): resolve species and breed names for a holder's pets`) adds
  `speciesName`/`breedName` to the pet projections from the global reference
  tables.
- **No Playwright/E2E** (TD-007 accepted deferral), so page coverage was
  component-level with mocked fetch.

## Limitations recorded at trace time (check current state before relying)

- Two concurrent first-time profile `PUT`s can still leave the holder without
  exactly one primary phone; nothing in the database backstops the invariant
  (recorded as DEC-006).
- The portal-management scenario "Cross-tenant profile target rejected → 404"
  presumed a target-bearing route; the self-only read/write route makes a
  supplied identifier a `400` instead. The scenario was reworded, not coded.
- **`INTERNAL` 5xx messages no longer reach the client — fixed after this
  trace.** PR #60 (`fix/honest-error-copy`) made the global exception filter
  derive the 5xx set from the frozen error registry and substitute the generic
  per-code copy, so a portal integrity-breach message stays in the request log
  instead of the response body. Non-5xx domain messages still reach the client
  verbatim. The trace-time leakage claim is therefore obsolete; see
  `docs/05-modules/Portal.md` → "Known Limitations / Residual Risks".
- The trace-time WU4D goal named a `profile` page. The archival record leaves
  task 4.3 unchecked for that page; a later `feat/epic-08-portal-profile-page`
  branch merged as PR #55 (`c9959db`) after the `27bc04a` closure baseline.
  Confirm current state in `docs/05-modules/Portal.md`, not here.

## Next step

Use this file only to recover WU4 history. For behavior, acceptance and
verification, read `openspec/changes/archive/2026-09-21-epic-08/tasks.md`,
`archive-report.md`, the standing specs, and
`docs/01-roadmap/EPIC-08-Portal.md`.
