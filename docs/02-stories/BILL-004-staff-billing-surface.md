---
id: BILL-004
type: story
title: Staff billing surface
epic: EPIC-14
status: review
priority: high
depends_on:
  - BILL-002
  - BILL-003
prd_sections:
  - "9"
  - "10"
  - "21"
  - "22"
  - "27"
  - "28"
  - "29"
  - "36"
  - "41"
permissions:
  - billing.read
  - billing.create
  - billing.confirm
  - billing.cancel
branch: feat/epic-14-billing-staff-surface
created: 2026-10-01
updated: 2026-10-01
---

# BILL-004 — Staff billing surface

## Objective

Deliver the staff Billing workspace: a status-filtered invoice list, an invoice
detail with the immutable snapshot lines and the server-computed totals, a
create-from-completed-sale flow, and confirm and cancel with a reason. The
surface consumes the routes [[BILL-002]] and [[BILL-003]] ship, adds no API
route, performs no money arithmetic and shows no fiscal state.

## Context

- The repository's Definition of Done requires the staff surface in the same
  epic as the behavior it exposes, with full UX state coverage and semantic
  design tokens only ([[DEC-037]], [[DEC-045]]).
- `apps/web/src/app/api/cash/` and `apps/web/src/app/api/sales/` are the shipped
  proxy precedents: a Next.js route handler that forwards staff cookie context,
  allowlists the forwarded routes and rejects everything else. The client module
  is colocated in the surface's own route directory, which EPIC-13 established
  when it moved the Cash client.
- `apps/web/src/components/shell/nav-sidebar.tsx` carries `POS`
  (`requiredFeature: "sales"`) and `Cash` (`requiredFeature: "cash"`) and no
  Billing entry; the `billing` feature code is already seeded ([[DEC-040]]).
- [[DEC-045]] scopes this surface to one operational workspace and excludes a
  printable document; [[DEC-044]] keeps the portal surface, the print/export
  path and reports outside the epic.
- `apps/web/src/app/(app)/app/` has no `billing/` directory today, and
  `apps/api/src/rbac/route-contract.probe.test.ts` actively fails the build if
  any route appears under `/portal/invoices`, `/portal/documents` or
  `/portal/files`.
- [[DEC-040]], [[DEC-042]], [[DEC-044]] and [[DEC-045]] were accepted on
  2026-10-01 by the maintainer and are binding on this Story.

## In Scope

- The Billing-owned staff route directory at
  `apps/web/src/app/(app)/app/billing/`, holding the pages, the client module,
  the query helpers and the tests.
- The authenticated Next.js proxy at
  `apps/web/src/app/api/billing/[[...path]]/route.ts`, allowlisting only the
  Billing routes and forwarding staff cookie context only.
- The invoice list with its status filter, the invoice detail with the snapshot
  lines, status, number and confirmation/cancellation timestamps, the
  create-from-a-completed-sale flow, the confirm action and the cancel action
  with a required reason.
- The state coverage: loading, empty, error, success, permission-denied and
  entitlement-denied, plus the distinct command outcomes (a confirm replay, a
  conflict, a cancel replay).
- The capability-gated navigation entry behind `requiredFeature: "billing"`,
  with the dormant-gate limitation recorded.
- Component, proxy and navigation tests, including the UX-only branch
  assertions.
- This Story and the epic record.

## Out of Scope

- **Any backend API, schema, migration, seed or permission change.** The
  contracts are fixed by [[BILL-001]], [[BILL-002]] and [[BILL-003]]; this Story
  consumes them and adds no NestJS route and no new permission key.
- **Browser-side authorization as a source of truth.** Frontend permission and
  capability checks are UX only; the backend remains the authority (PRD §9).
- **Draft invoice editing** — [[DEC-038]]; the surface offers confirm and cancel
  only, never an edit.
- **Fiscal state, fiscal actions and a fiscal document view** — [[EPIC-15]] and
  [[DEC-042]]; the surface shows no fiscal status because none exists.
- **Portal invoices and documents** — deferred, with the route-contract probe
  prohibition intact ([[DEC-044]]).
- **Printable invoice rendering, PDF export and report generation** —
  [[DEC-018]], [[DEC-039]], [[DEC-044]] and [[DEC-045]].
- **Invoice reports and dashboards** — [[EPIC-18]].
- **Email or WhatsApp invoice delivery** — [[EPIC-17]].
- **Refund, reversal and cash-compensation affordances** — [[TD-018]].
- **Accounts receivable, credit ledger and invoice payment allocation** —
  [[DEC-044]].
- **A sale reversal or sale-cancel flow from the Billing surface** — [[TD-018]]
  and [[BILL-002]].
- **Offline mode, a local queue or a service worker.**
- **A PRD edit.** No decision here requires one.

## Acceptance Criteria

- [x] Staff can list invoices with a status filter, open one invoice's detail
      with its snapshot lines and totals, create an invoice from a completed
      sale, confirm it and cancel it with a reason. Evidence: the Billing pages
      and their tests.
- [x] The UI covers loading, empty, error, success, permission-denied and
      entitlement-denied states, and backend authorization remains the
      authority. Evidence: the state-branch coverage listed in the Story.
- [x] The client module lives in a Billing-owned route directory behind a
      `/api/billing` proxy that allowlists only the Billing routes and forwards
      staff cookie context only. Evidence: the proxy tests and the allowlist.
- [x] The navigation entry is gated behind the `billing` capability as far as
      the existing shell supports, with the dormant-gate limitation recorded.
      Evidence: the `requiredFeature` declaration, its visibility tests and the
      recorded limitation.
- [x] The surface displays server-computed values as returned, performs no money
      arithmetic and shows no fiscal state. Evidence: the detail-panel tests and
      the absence of arithmetic in the client module.
- [x] Reusable UI uses semantic design tokens only, with no Veterinary-specific
      brand literal. Evidence: the shared control classes and the `@newsaas/ui`
      primitives.
- [x] No portal route, printable document or export is added. Evidence: the
      route-contract probe still failing on the deferred portal roots.
- [x] Tenant isolation is enforced when applicable. Evidence: the proxy forwards
      no client-supplied tenant identifier, and the panel tests assert that a
      backend `404` renders as an error state rather than as data.
- [x] Backend authorization is enforced when applicable. Evidence: the
      permission-denied and entitlement-denied branches are UX affordances with
      their own tests, and the surface adds no route that could bypass the API
      guards.
- [x] Required loading/error/empty/success UX exists. Evidence: the four state
      branches plus the permission-denied and entitlement-denied branches are
      each covered by a test.
- [x] Required audit exists. Evidence: not applicable; the surface writes no
      audit of its own and every command it issues is audited by [[BILL-003]].
- [x] Tests required by the Story pass. Evidence: the web component, proxy and
      navigation suites are green in the merged work unit.

## Domain Invariants

- **The surface is a client of the shipped contracts.** It computes no money,
  applies no tax, allocates no number and writes no state the API does not own.
- **Invoice lines and totals are displayed as returned.** Billing performs no
  money arithmetic anywhere, including in the browser ([[DEC-038]]).
- **Authorization is real on the server.** Permission and capability branches
  are UX affordances; they never replace the API's checks (PRD §9).
- **No fiscal state is shown.** The invoice carries no fiscal status in this
  epic, and the surface must not imply one ([[DEC-042]]).
- **`CANCELLED` is terminal and drafts are never edited.** The surface offers no
  edit or reopen affordance at any status ([[DEC-038]], [[DEC-043]]).
- **Tenant identity is server-owned.** No browser value is treated as authority
  over which tenant's data is read or written.
- **Branding is token-driven.** No Veterinary-specific or tenant-specific visual
  literal exists inside a reusable component.
- **No printable or exported document exists**, and the surface must not present
  a print or download affordance ([[DEC-044]], [[DEC-045]]).

## API

### Added

```text
None yet
```

This Story adds no NestJS API route. It adds the Next.js proxy route
`/api/billing/[[...path]]` and the staff pages, which forward to the API routes
[[BILL-002]] and [[BILL-003]] ship. No `PATCH`, `PUT` or `DELETE` is forwarded,
and no portal route is added.

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

- None. The surface consumes the shipped DTOs and adds no table.

## UI

Planned surface, consuming semantic design tokens only:

- The Billing-owned route directory at `apps/web/src/app/(app)/app/billing/`
  with the invoice list, the status filter and the invoice detail view.
- The detail view shows the immutable snapshot lines, the server-computed money
  totals, the status, the allocated series and number and the
  confirmation/cancellation timestamps as returned by the API.
- The create-from-a-completed-sale flow, the confirm action and the cancel
  action with its required reason.
- The state coverage: loading, empty, error, success, permission-denied and
  entitlement-denied, plus the command outcome mapping for a replay and a
  conflict.
- The navigation entry with `requiredFeature: "billing"`.
- Reusable components consume semantic branding tokens; no project-specific
  brand literal, no arbitrary CSS and no injected styling.
- No fiscal state, no print or export affordance, no portal route and no edit
  affordance.

## Implementation Summary

Implemented and committed on `feat/epic-14-billing-staff-surface` across two
work units plus one bounded review correction:

- **W1 `feb344d`** — the authenticated `/api/billing/[[...path]]` proxy and the
  typed client `billing-api.ts`.
- **W2 `ef5e1c4`** — the workspace: `billing-surface.tsx`, the list, detail and
  create panels, `billing-display`, `billing-validation`, `billing-outcome`, the
  page and the capability-gated navigation entry.
- **Correction `d946d4a`/`b3238cf`** — the CRITICAL finding the native review
  raised, with the regression coverage it asked for.

No API, schema or migration change: the surface consumes the four `billing`
routes [[BILL-002]] and [[BILL-003]] shipped.

## Verification

```text
pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts \
  'src/app/(app)/app/billing' src/components/shell
  -> 11 files / 104 tests passed

pnpm --filter @newsaas/web test
  -> 90 files / 1052 tests passed (was 81 / 940 before this Story)

pnpm typecheck / pnpm lint / pnpm format-check
  -> 14 / 14, 14 / 14, clean

git diff --numstat ef5e1c4..HEAD   (the review correction range)
  -> 196 changed lines, against the review's 200-line budget
```

## Tests Added

- `apps/web/src/app/api/billing/[[...path]]/route.test.ts` — 27 cases: the
  five-operation allowlist and nothing else, the staff-cookie-only forwarding,
  the absence of any synthesized tenant or permission header, the
  out-of-contract query and body rejections, the malformed-path rejections, the
  portal-cookie refusal, and the unchanged no-`PATCH`/no-`PUT`/no-`DELETE`
  posture.
- `apps/web/src/app/(app)/app/billing/billing-api.test.ts` — 16 cases: the
  DTO-exact fields, the server's money strings returned verbatim, each helper's
  request shape, and the failure branches kept distinguishable.
- The panel and surface suites — the list with its status filter, the detail
  with the snapshot lines and the API's totals, the create flow, the confirm and
  cancel actions, and every state branch including the entitlement denial, the
  permission refusal and a backend `404` rendered as an error rather than as
  data.
- `billing-surface.test.tsx` — the regression coverage the review asked for: a
  pending confirm plus a selection change, a failed cancel plus a selection
  change, a late resolution that does not render on the other invoice, and
  returning that shows the invoice's own settled outcome.
- `apps/web/src/components/shell/nav-sidebar.test.tsx` — the entry count, the
  new link, and two cases proving the `billing` gate is independent of `sales`
  and `cash` in both directions.

## Known Limitations

- **A replay cannot be shown as a distinct outcome.** The API returns the same
  `200` body for a fresh confirm or cancel and for a replay, and exposes no
  replay discriminant in the DTO ([[DEC-041]] chose that deliberately). The
  surface therefore renders a replay safely and never claims a second
  confirmation, but it cannot print "already confirmed". The Story's scope item
  asking for the replay as a _distinct_ command outcome is satisfied only in the
  weaker replay-safe-rendering sense; a conflict, by contrast, is a real `409`
  and is shown as such.
- **The navigation entitlement gate is dormant.** The shell accepts an optional
  `entitlements` prop and defaults to _unknown = show_, and no browser-side
  entitlement source exists, so the gate is unit-testable but not fed in
  production. The backend `FEATURE_NOT_ENTITLED` remains the authority. The same
  limitation EPIC-13 recorded.
- **The invoice entry point is a completed-sale id.** The epic never fixed how
  an operator picks the sale, and the shipped POS surface has no invoice link,
  so the create panel takes the sale id directly rather than inventing a picker.
- **The list is unbounded** ([[TD-026]]) and the invoice line order is
  deterministic but arbitrary ([[TD-025]]); an over-long catalog item name
  blocks invoicing rather than being truncated ([[TD-024]]).
- The surface shows no fiscal state and offers no fiscal action, so it says so
  rather than implying that a submission happened ([[DEC-042]]).
- No printable document, PDF export or number formatting exists, and no print or
  download affordance is presented ([[DEC-039]], [[DEC-044]], [[DEC-045]]).
- No portal invoice read exists, so a customer cannot see an invoice in this
  epic ([[DEC-044]]).
- The proxy follows the documented staff-proxy rejection contract and adds no
  third divergence from it ([[TD-013]]).
- **The Story's native review is escalated, not closed.** See the completion
  notes.

## Technical Debt

- [[TD-013]] records the existing staff-proxy rejection inconsistency; the
  Billing proxy follows the documented contract and adds no divergence.
- [[TD-018]] stays open. The surface ships no refund, reversal or
  cash-compensation affordance, and cancelling an invoice reverses no money.
- [[TD-022]] tracks the deferred portal invoice and document surface, kept
  current by [[BILL-005]].
- [[TD-024]], [[TD-025]] and [[TD-026]] are visible to the operator through this
  surface and stay open; none is worsened by it.

## Decisions / ADRs

- [[DEC-040]] — the four `billing.*` keys consumed here as UX gates only, with
  the `billing` entitlement and the backend as the authority.
- [[DEC-042]] — fiscal boundary ownership: the surface shows no fiscal state
  because no fiscal state exists in this epic.
- [[DEC-044]] — epic scope boundaries: no portal route, no printable document
  and no report surface.
- [[DEC-045]] — the staff surface scope: one operational workspace with full
  state coverage and no printable document.
- No ADR is required: the surface introduces no architecture change the
  complexity budget gates.

## Files / Modules

Implemented. Created:

- `apps/web/src/app/api/billing/[[...path]]/route.ts` and its test
- `apps/web/src/app/(app)/app/billing/billing-api.ts` and its test
- `apps/web/src/app/(app)/app/billing/billing-surface.tsx` and its test
- `apps/web/src/app/(app)/app/billing/invoice-list-panel.tsx` and its test
- `apps/web/src/app/(app)/app/billing/invoice-detail-panel.tsx` and its test
- `apps/web/src/app/(app)/app/billing/create-invoice-panel.tsx` and its test
- `apps/web/src/app/(app)/app/billing/billing-display.ts` and its test
- `apps/web/src/app/(app)/app/billing/billing-validation.ts` and its test
- `apps/web/src/app/(app)/app/billing/billing-outcome.tsx` and its test
- `apps/web/src/app/(app)/app/billing/page.tsx`

Changed:

- `apps/web/src/components/shell/nav-sidebar.tsx` and its test

## Completion Notes

The Story is `review`, not `done`: implementation, the local gates and the
regression coverage are complete on `feat/epic-14-billing-staff-surface`, but no
CI receipt exists yet because the pull request is not open. It moves to `done`
when the branch's pull request merges with both required checks green, together
with the QA evidence entry.

**Its native review is escalated, not closed.** Lineage
`review-eb548b67172897d8` raised one CRITICAL finding — the surface shared one
confirm/cancel mutation state across invoices, so a selection change could carry
the previous invoice's error, pending label or late outcome onto another — and
that correction is applied, committed and verified. The review could not be
closed because the targeted-validation slot was refused at admission twice and
the authority escalated to the terminal `native_stop_required` with cause
`targeted_validator_rejected`. A read-only authority inspection reports the
authority `valid` and `complete` with **no sanctioned exits**, so nothing is
left to repair or to exit through, and no verdict was authored.

The consequence is recorded rather than hidden: this candidate has **no closed
review verdict**, and the fail-closed path applies — a separate verifier is
re-enabled for it instead of the review-credit discount. Delivery is unaffected,
because a review outcome never authorizes delivery.
