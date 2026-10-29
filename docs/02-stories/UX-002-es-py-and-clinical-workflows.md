---
id: UX-002
type: story
title: Spanish Paraguay and staff workflow clarity
epic: EPIC-03
related_epics: [EPIC-06, EPIC-07, EPIC-12]
status: review
priority: high
depends_on: [UX-003]
prd_sections: ["3", "6", "10.1", "13", "18", "19", "29", "31"]
permissions: []
branch: main
created: 2026-10-26
updated: 2026-10-28
---

# UX-002 — Spanish Paraguay and staff workflow clarity

## Scope

Follow [[UX-001]] with an `es-PY` staff experience and clearer end-to-end
appointment, clinical encounter and point-of-sale interactions. Retain tenant
authorization, typed commands, exact Decimal strings, patient-data boundaries,
and existing API contracts. Locale changes are presentation only. No PRD edit,
new dependency, persistence, tenant setting or backend endpoint is approved by
this Story.

The rollout establishes staff language and the three prioritized staff journeys.
Translations on unrelated operational modules and the customer Portal are a
separate follow-up; do not claim these surfaces are localized by inference.

## Acceptance Criteria

- [x] Staff shell and prioritized screens use Spanish terminology and Spanish
      Paraguay dates/number presentation. Persisted instants stay in their
      existing tenant timezone and Decimal values are never converted through
      JavaScript `Number`.
- [x] Confirming a consequential staff operation uses a keyboard-accessible
      modal with context, a clear cancel path, pending and error feedback, and
      no false success. Business commands and ledger invariants remain
      unchanged.
- [x] Agenda creation identifies a patient by a readable staff-visible name; the
      user can open the linked patient from an appointment and continue to its
      clinical encounter without copying a UUID.
- [x] Clinical encounter closure resolves the current draft safely before its
      immutable close command. Internal notes remain staff-only. Form errors
      identify the relevant field and can be corrected without guessing.
- [x] POS review shows the API's authoritative total and payment breakdown,
      explains exact-sum validation, and confirms before the existing complete
      command. It adds no tender/change, tax calculation, credit or duplicate
      stock/cash effect.
- [x] Required verification is green and this Story records implementation,
      limitations and evidence before it is marked done.

## Invariants

See [[VET-004]], [[POS-003]], [[POS-004]], [[DEC-020]], [[DEC-021]],
[[DEC-022]], [[DEC-028]], [[DEC-029]], [[DEC-080]] and [[DEC-081]]. An
appointment never derives its duration from a service. A closed encounter
remains immutable; a failed/conflicted save cannot close it. The API stays the
authority for sale price, totals, stock, cash, session, patient and permission
state.

## Working notes

- Approved Epic stories exclude changes to the core appointment DTO, clinical
  model and POS commands. If resolving staff/provider identity or pagination
  needs a backend contract, record that decision before expanding this scope.
- [[DEC-081]] was accepted on 2026-10-27. [[UX-003]] supplies the bounded,
  authorized Veterinary patient/guardian lookup and named agenda identities;
  verification is recorded in that Story before this criterion is closed.
- UX-002 code includes es-PY labels and formatting for the staff shell, agenda,
  clinical encounter and POS; accessible confirmation dialogs for appointment
  transitions, clinical closure, sale completion and deactivation; exact comma
  decimal input normalization; and Spanish error/empty/loading feedback on the
  prioritized surfaces.
- TypeScript and targeted ESLint passed on 2026-10-26; `git diff --check`
  passed. The full lint run did not finish, and build, automated tests and
  manual keyboard/screen-reader workflow checks remain pending. Keep status
  `in-progress`.
- A fresh browser tab at `http://localhost:3000/app` still served English
  navigation/dashboard labels and an unformatted `185000.00`, while the current
  checkout sources contain Spanish labels and es-PY formatting. The preview
  could not be matched to this checkout; Docker CLI inspection failed with
  access denied to the Docker Desktop engine pipe. Visual validation remains
  pending until the correct local runtime is available.
- On 2026-10-27 the local stack was started from this checkout and the preview
  discrepancy was resolved: Spanish shell/dashboard, `Gs. 185.000`, named agenda
  identities and patient/guardian search were observed against real PG.
  [[UX-003]] records the additive identity API and its verification.
- POS review found read-only grouped formatting reused in editable price and
  payment fields. Editable API values now preserve digits/scale with comma
  decimals; strict local parsing treats dots as grouping and rejects malformed
  or non-local decimals. `buildSaleLines` rejects invalid carts before producing
  a payload. The earlier verification pause and subsequent targeted results
  are recorded in the 2026-10-28 QA follow-up.
- Keyboard review verified forward/backward focus cycling and Escape/trigger
  restoration in a confirmation. Clinical closure was opened then cancelled;
  sale completion and clinical mutation E2E verification are not claimed.

## Verification follow-up — 2026-10-28

- Resumed UX-002 verification after the maintainer requested continuation.
- Updated existing clinical/cart/payment cases to Spanish, local decimal entry
  and explicit confirmation without dropping save-conflict, exact-sum,
  permission or immutable-close assertions.
- Added regressions for exact decimal round trips above JavaScript's safe-integer
  range, grouped prices, fractional quantities, invalid input, cancelled/failed
  payment confirmation, cancelled clinical closure, save-before-close, failed
  saves and edits arriving during that save.
- Save-before-close reproduced a stale-version bug: the chained close read the
  old encounter ref before React rendered the save response. Applying the
  authoritative response now updates that ref synchronously. Close uses the
  returned version; a failed save or newer local edit still prevents closing.
- Suppressed the duplicate background error while the clinical close modal
  displays its authoritative error. Cancelling restores the editor's error.
- Seven targeted web suites passed: 131/131 cases (17 locale, 14 cart, 15 payment,
  31 clinical, 42 agenda, 4 selector and 8 patient proxy). HTTP responses are
  synthetic; no real clinical or financial operation was submitted.
- Web typecheck, targeted ESLint, production build and build-output verification
  passed. The sandbox's initial `.next` EPERM was resolved by an unsandboxed
  build; this is an environment limitation, not a hidden failing build.
- Keep `in-progress`: component/proxy tests do not replace full browser mutation
  journeys against the API/database or a full screen-reader review.

## Browser follow-up — 2026-10-28

The requested local mutation review now covers creation/confirmation of Michi's
16:00 appointment, opening its linked patient, saving/closing an explicitly
synthetic clinical draft, and completing a Gs. 120.000 demo service sale by QR
method (no external processor). Cancellation and insufficient payment feedback
were also checked. See the detailed QA evidence for remaining limitations.

The review reproduced and corrected a three-hour discrepancy in FullCalendar:
named zones were configured without an implementation. A calendar-only Intl
adapter now shares the existing tenant conversion helpers; persisted instants
and REST contracts are unchanged. Real FullCalendar tests and browser comparison
verify that the grid and list agree. The POS review quantity also now consumes
the existing exact local formatter.


## Access and professional identity follow-up — 2026-10-28

The maintainer requested the remaining Spanish access, professional names and
accessibility review. [[DEC-082]] records the additive displayName projection
on existing agenda options, with unchanged scheduling permission, tenant and
VETERINARIAN filtering. Only membershipId/displayName leave the boundary; email,
profile IDs and credentials are excluded. No new endpoint or migration.

Staff login, recovery and password-reset views now use Spanish. Stable auth
codes map to uniform Spanish errors without account/token enumeration. Native
form submission, HttpOnly session handling, password clearing on login failure
and backend policy remain intact. Recovery acceptance stays conditional; no
claim is made that a message reached an unknown address. Success/error live
regions, real headings and field-linked validation descriptions were added.
Reset completion/missing-token states offer a path back to login.

Professional names appear in create/approval/filter controls and appointment
list rows while commands still submit membership IDs. Missing or blank names
use an explicit shortened-ID fallback. The new displayName is CONFIDENTIAL
staff identity, staff-only and without new logging/retention behavior.


Targeted access/name checks: 64 web, 45 service and 18 HTTP cases passed; both
builds, typechecks and targeted ESLint passed. New browser verification remains
pending because local Browser Use is disabled in Work settings. Keep status
in-progress rather than infer visual or spoken-output verification from tests.


## Current review state — 2026-10-28

Visual verification resumed successfully after reconnecting the integrated
browser. Login/recovery/missing-token views are Spanish, failed login clears the
password and exposes a linked uniform error, and the demo login works with
Enter. Professional names were observed in agenda filter/create/approval/list;
filtering still works. Confirmation focus cycle, Escape and trigger restoration
were verified without mutating the pending request. See the QA evidence and
screenshots. No application code changed in this final visual pass and previous
checks were not re-run unnecessarily.

Status is review: implementation and scoped verification are ready for review.
A comprehensive screen-reader/spoken-output audit remains outside the evidence
claimed here; native date picker appearance still follows the browser locale.


## Clinical form follow-up — 2026-10-28

The maintainer approved improving the clinical form and closure next. Retain
existing commands and optional fields: preserve spaces while typing, mirror the
API 10,000-character limit with linked field errors, expose manual save/retry,
protect pending edits on navigation, review content before closure, and show the
immutable closed record. Verify focused tests, lint, typecheck, build and a
synthetic demo create/save/close journey where browser access permits.

Appointment/professional linkage is explicitly outside VET-004 and absent from
the clinical DTO. The compatible implementation retains patient-based navigation;
no appointment/professional association or clinical-to-sale command is invented.
No new persisted field, endpoint, dependency, clinical requirement or Portal
projection. Existing confidential content stays in memory and staff reads only.


### Follow-up implementation and verification

Preserved working-copy spaces, linked field length errors/counters, blocked invalid
writes, manual save/retry, stopped unchanged automatic error retries, restored
StrictMode autosave lifecycle, protected encounter switching, and added clicked-link
exit confirmation/native unload protection. Closure reviews current staff content;
closed records now render persisted content read-only beside explicit amendments.

53 scoped tests passed; targeted ESLint and web typecheck passed. Real browser
synthetic create/autosave/review/cancel/close/read-only and Agenda-to-patient access
passed. Final production build and output verifier passed, including the keyboard-focusable
summary. See [[UX-VALIDATION-2026-10-27]]. No new
API/migration/dependency/field or backend authorization changes. Backend isolation
and immutable transitions are retained rather than reimplemented in the UI.

[[TD-065]] records browser history/programmatic navigation protection limits.
A full screen-reader audit is not claimed; clinical-to-sale and persisted
appointment/professional associations remain outside this implementation.


## TD-065 recovery follow-up — 2026-10-28

Same-document route unmounts retain the pending clinical working copy in the
existing QueryClient memory for ten minutes. Fresh access reads gate recovery;
manual save, version conflict handling and closed-record immutability remain
explicit. No browser storage/history patches or new API. 44 clinical and 16
related UI tests passed; targeted lint/types passed; browser Back/Forward recovered
an oversized unsaved synthetic field. See [[TD-065-clinical-history-navigation-guard]]
for limits and final build evidence. Earlier history-loss notes above are historical.

Final TD-065 production build/output verification passed. TD-065 is resolved
within its documented same-document recovery boundary.


## POS recovery follow-up — 2026-10-28

Continue approved recovery UX over existing sales reads/commands. Remove conflicting
claims after a lost/unknown completion response; require authoritative state review
before another completion. Counter links to the existing sale detail; detail can
explicitly refresh state before a retry. Keep entered payments on the detail page,
block confirmation as well as submit, and never infer replay/recorded payments
from a sale status read. No new endpoint, financial effect, schema or dependency.


### POS recovery implementation and verification

Corrected contradictory counter copy for transport/unrecognized completion
responses. Counter requires the existing authoritative detail read before retry;
detail exposes explicit state refresh and retains entered payments while DRAFT.
A completed/cancelled read removes the payment form, without inventing replay
semantics or payment history. Disabled state applies inside an open confirmation.
55 targeted tests, TypeScript, ESLint, production build and output verifier passed.
No new browser mutation, backend endpoint, dependency or financial invariant.
No full web regression claim; old English assertions in unrelated POS suites were
not treated as current verification. Updated outcome assertions retain the full
failure matrix in Spanish. See [[Sales]] for the contract boundary.
