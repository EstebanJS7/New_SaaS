---
id: BILL-004
type: story
title: Staff billing surface
epic: EPIC-14
status: planned
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
branch:
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
- [[DEC-040]], [[DEC-042]], [[DEC-044]] and [[DEC-045]] are **proposed**, not
  accepted. Implementation must not start until the maintainer accepts or amends
  them.

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

- [ ] Staff can list invoices with a status filter, open one invoice's detail
      with its snapshot lines and totals, create an invoice from a completed
      sale, confirm it and cancel it with a reason. Evidence: the Billing pages
      and their tests.
- [ ] The UI covers loading, empty, error, success, permission-denied and
      entitlement-denied states, and backend authorization remains the
      authority. Evidence: the state-branch coverage listed in the Story.
- [ ] The client module lives in a Billing-owned route directory behind a
      `/api/billing` proxy that allowlists only the Billing routes and forwards
      staff cookie context only. Evidence: the proxy tests and the allowlist.
- [ ] The navigation entry is gated behind the `billing` capability as far as
      the existing shell supports, with the dormant-gate limitation recorded.
      Evidence: the `requiredFeature` declaration, its visibility tests and the
      recorded limitation.
- [ ] The surface displays server-computed values as returned, performs no money
      arithmetic and shows no fiscal state. Evidence: the detail-panel tests and
      the absence of arithmetic in the client module.
- [ ] Reusable UI uses semantic design tokens only, with no Veterinary-specific
      brand literal. Evidence: the shared control classes and the `@newsaas/ui`
      primitives.
- [ ] No portal route, printable document or export is added. Evidence: the
      route-contract probe still failing on the deferred portal roots.
- [ ] Tenant isolation is enforced when applicable. Evidence: the proxy forwards
      no client-supplied tenant identifier, and the panel tests assert that a
      backend `404` renders as an error state rather than as data.
- [ ] Backend authorization is enforced when applicable. Evidence: the
      permission-denied and entitlement-denied branches are UX affordances with
      their own tests, and the surface adds no route that could bypass the API
      guards.
- [ ] Required loading/error/empty/success UX exists. Evidence: the four state
      branches plus the permission-denied and entitlement-denied branches are
      each covered by a test.
- [ ] Required audit exists. Evidence: not applicable; the surface writes no
      audit of its own and every command it issues is audited by [[BILL-003]].
- [ ] Tests required by the Story pass. Evidence: the web component, proxy and
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

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- `apps/web/src/app/(app)/app/billing/*.test.tsx` (planned) — the list and its
  status filter, the detail view with the snapshot lines and totals as returned,
  the create, confirm and cancel flows with their outcome mapping, and the six
  state branches.
- `apps/web/src/app/api/billing/[[...path]]/route.test.ts` (planned) — the
  cookie-only forwarding, the allowlisted route, query and body rebuild, the
  unknown-key and unknown-route rejections, the absence of any client-supplied
  tenant authority and the unchanged no-`PATCH`/no-`DELETE` posture.
- `apps/web/src/components/shell/nav-sidebar.test.tsx` (planned update) — the
  Billing entry and its capability-gated visibility.
- `apps/api/src/rbac/route-contract.probe.test.ts` (planned update) — the
  unchanged proof that no portal invoice, document or file route exists.

## Known Limitations

- Nothing is implemented. The Story is `planned` and every criterion is
  unchecked.
- [[DEC-040]], [[DEC-042]], [[DEC-044]] and [[DEC-045]] are proposed, not
  accepted; implementation must not start before the maintainer accepts or
  amends them.
- **The navigation entitlement gate is dormant.** The shell accepts an optional
  `entitlements` prop and defaults to _unknown = show_, and no browser-side
  entitlement source exists, so the gate is unit-testable but not fed in
  production. The backend `FEATURE_NOT_ENTITLED` remains the authority. This is
  the same limitation EPIC-13 recorded.
- The surface shows no fiscal state and offers no fiscal action, so it must say
  so rather than imply that fiscal submission happened ([[DEC-042]]).
- No printable document, PDF export or number formatting exists; the surface
  must not present a print or download affordance ([[DEC-039]], [[DEC-044]],
  [[DEC-045]]).
- The epic does not define how the operator chooses the completed sale to
  invoice. There is no invoice link in the shipped POS surface, so the slice
  must resolve the entry point without extending scope and record the resolution
  here.
- No portal invoice read exists, so a customer cannot see an invoice in this
  epic ([[DEC-044]]).
- The epic does not fix the list pagination shape, the default page size or the
  exact status filter values; the slice must follow the shipped list precedent
  rather than introduce a new one.
- Draft editing is unavailable, so a wrong draft is cancelled and rebuilt from a
  new sale ([[DEC-038]]).
- The proxy must follow the documented staff-proxy rejection contract and must
  not add a third divergence from it ([[TD-013]]).

## Technical Debt

- [[TD-013]] records the existing staff-proxy rejection inconsistency; the
  Billing proxy must follow the documented contract and must not worsen it.
- [[TD-018]] stays open. The surface ships no refund, reversal or
  cash-compensation affordance, and cancelling an invoice reverses no money.
- [[TD-022]] tracks the still-deferred portal invoice and document surface; it
  was created during the EPIC-14 kickoff and is kept current by [[BILL-005]]
  ([[DEC-044]]).
- No other debt is planned. If a slice ships a shortcut it must create a debt
  record rather than hide it.

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

Planned paths; nothing below exists yet.

- `apps/web/src/app/(app)/app/billing/`
- `apps/web/src/app/api/billing/[[...path]]/route.ts`
- `apps/web/src/components/shell/nav-sidebar.tsx`
- `apps/web/src/components/shell/nav-sidebar.test.tsx`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `docs/01-roadmap/EPIC-14-Billing.md`

## Completion Notes

_Status must remain non-done until all required gates pass._

This Story stays `planned` while nothing exists. It may not be marked `done`
before the maintainer accepts or amends the decisions it depends on, the full
state coverage is tested, the dormant navigation gate is recorded as a
limitation, and the merged work units carry their CI receipts.
