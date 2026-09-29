---
id: POS-004
type: story
title: Staff POS surface
epic: EPIC-12
status: planned
priority: medium
depends_on:
  - POS-001
  - POS-003
prd_sections:
  - "7"
  - "9"
  - "10"
  - "18"
  - "19"
  - "27"
  - "28"
  - "29"
permissions:
  - sales.read
  - sales.create
  - sales.update
  - sales.cancel
  - sales.complete
  - cash.read
  - cash.session.open
branch:
created: 2026-09-27
updated: 2026-09-27
---

# POS-004 — Staff POS surface

## Objective

Deliver the staff browser surface for the counter sale: an item search, a sale
line editor that pre-fills the catalog reference price and allows the operator
override, an optional customer selector, a payment capture, and a completion
flow that surfaces each distinct outcome honestly. The surface consumes the
routes [[POS-001]] and [[POS-003]] ship and adds no route, no schema change and
no new permission key.

The surface is optimized for keyboard and touch, follows the semantic
design-token rule, and presents item resolution by name because the deferred
barcode makes a scanner equivalent to typing ([[DEC-025]]).

## Context

- PRD §18 says the POS is "optimized for keyboard, barcode scanner, touch and
  tablet". [[DEC-025]] records that EPIC-12 does not deliver the scanner
  optimization because the catalog has no SKU or barcode column
  (`schema.prisma:1286`), and tracks the gap as [[TD-019]].
- [[DEC-022]] makes the item reference price a suggestion the operator may
  override, so the line editor must show the pre-filled price and accept a
  replacement.
- [[DEC-028]] makes the customer optional, so the selector must be optional and
  must not block a walk-in sale.
- [[DEC-026]] makes the `sales` entitlement gate the surface, so the browser
  must hide the module for a tenant without the capability while the backend
  check remains mandatory. Frontend permission and entitlement checks are UX
  only (PRD §9).
- The EPIC-11 staff surfaces are the precedent for the proxy rejection contract,
  the state coverage and the semantic-token rule; [[TD-013]] records the known
  proxy divergence the surface must not worsen.

## In Scope

- `apps/web/src/app/api/sales/[[...path]]/route.ts` and
  `apps/web/src/app/api/cash/[[...path]]/route.ts` — the authenticated proxies
  that forward only the staff session cookie and rebuild an allowlisted query
  and body.
- `apps/web/src/app/(app)/app/sales/` — the POS pages: the counter surface, the
  draft detail and the line editor.
- `apps/web/src/app/(app)/app/sales/` — the client modules, schemas, query
  helpers and the outcome mapping for the completion flow, colocated with the
  pages exactly as the EPIC-11 purchases and suppliers surfaces are.
- The item search over the shipped catalog read API, the reference-price
  pre-fill with the operator override, the optional customer selector and the
  payment capture.
- The state coverage: loading, empty, error, success, permission-denied and
  entitlement-denied, plus the distinct completion outcomes.
- Component and proxy tests, including the UX-only branch assertions.
- This Story and the epic record.

## Out of Scope

- **Any API, schema, migration or seed change.** The backend contracts are fixed
  by [[POS-001]], [[POS-002]] and [[POS-003]]; this Story consumes them. It adds
  no route and no permission key.
- **Item codes, barcodes and SKU columns** — [[DEC-025]] and [[TD-019]].
- **Offline mode, a local queue, background sync or a service worker.** The POS
  requires the API.
- **Discounts, appointment links and patient links** — [[DEC-028]].
- **Change, tendered amount, overpayment and customer credit** — [[DEC-029]].
- **Session close, the expected/counted difference, the six remaining cash
  movement kinds and the cash UI** — EPIC-13. This Story consumes the
  session-open and cash read routes only.
- **Sale reversal and payment refund affordances** — [[DEC-023]] and [[TD-018]].
- **Invoices, billing and fiscal documents** — EPIC-14, EPIC-15 and EPIC-16. The
  surface shows no invoice or fiscal state.
- **Receipt or ticket printing** — [[DEC-027]]; a sale has no human-readable
  number.
- **Reports, dashboards and low-stock alerts** — EPIC-18.
- **End-to-end browser coverage** — the E2E gap is tracked separately, so this
  Story plans component and proxy tests rather than a Playwright suite.
- **A new Decision record or an ADR** — outside this Story's file surface.

## Acceptance Criteria

- [ ] The POS surface implements loading, empty, error, success,
      permission-denied and entitlement-denied states, and each state is covered
      by a test.
- [ ] The completion flow surfaces each distinct outcome honestly — a `201`
      success, a replay or non-`DRAFT` `409`, a payment-sum rejection, a missing
      `OPEN` session, a `403` and the shared `404` — and never presents an
      unconfirmed local state as a completed sale.
- [ ] Every component composes shared UI and semantic design tokens only: no
      brand literal, no arbitrary color, font or radius, and no injected
      styling.
- [ ] Item resolution uses the shipped tenant-scoped catalog read API by name;
      the input is keyboard-first and tablet/touch-friendly, and a barcode
      scanner behaves exactly like typing. The surface does not present barcode
      scanning as supported, and the deferred gap is recorded as [[TD-019]]
      ([[DEC-025]]).
- [ ] The line editor pre-fills the item reference price when one exists, allows
      the operator override, records the applied price through the API, and does
      not block the sale of an item with no reference price ([[DEC-022]]).
- [ ] The customer selector is optional and an empty selection does not block
      completion; the surface offers no discount field, no appointment picker
      and no patient picker ([[DEC-028]]).
- [ ] The payment capture accepts one or several payments across the six PRD §19
      methods, shows the sum against the sale total, and cannot submit a set
      that does not sum exactly; it shows no change and no credit field
      ([[DEC-029]]).
- [ ] The proxies forward only the staff session cookie, rebuild an allowlisted
      query and body, reject unknown keys and never treat a client-supplied
      tenant identifier as authority; a rejection is a clean error state rather
      than a silent fallback (PRD §7, PRD §29).
- [ ] Frontend permission and entitlement checks are UX only; the routes and the
      module remain enforced by the backend permission and the `sales`
      entitlement, and the surface adds no route and no new permission key
      ([[DEC-026]]).
- [ ] No CONFIDENTIAL or RESTRICTED payload is written to browser telemetry or
      analytics; audit remains server-side with stable ids and field names only
      (PRD §27, PRD §41).
- [ ] Component and proxy tests pass, and the Story adds no schema, migration,
      seed or backend route change.
- [ ] Required lint, typecheck, test, integration and build checks pass.

## Domain Invariants

- **The surface is a client of the shipped contracts.** It computes no money,
  applies no tax, allocates no number and writes no state the API does not own.
- **Authorization is real on the server.** The permission and entitlement
  branches are UX affordances; they never replace the backend check.
- **A completed sale reads as completed.** The surface never shows a locally
  assumed completion, because the API response is the authority.
- **No confirmed record is edited.** The surface offers no edit or delete
  affordance for a `COMPLETED` sale or payment.
- **Tenant identity is server-owned.** No browser value is treated as authority
  over which tenant's data is read or written.
- **Branding is token-driven.** No Veterinary-specific or tenant-specific visual
  literal exists inside a reusable component.

## API

### Added

```text
None yet
```

This Story adds no route. It consumes the routes and the permission and
entitlement contract shipped by [[POS-001]], [[POS-002]] and [[POS-003]].

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

- The counter page at `apps/web/src/app/(app)/app/sales/` with the item search,
  the line list, the optional customer selector, the totals display, the payment
  capture and the complete action.
- The draft detail page and the line editor, with the reference-price pre-fill
  and the operator override.
- The state coverage: loading, empty, error, success, permission-denied and
  entitlement-denied.
- The completion outcome mapping, including the replay and conflict outcomes.
- Reusable components consume semantic branding tokens; no project-specific
  brand literal, no arbitrary CSS and no injected styling.
- No barcode-scanner affordance, no discount field, no change field, no invoice
  state and no reversal or refund affordance.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

Planned coverage; none of it exists yet.

- `apps/web/src/app/(app)/app/sales/*.test.tsx` — component tests for the state
  coverage, the reference-price pre-fill with the operator override, the
  optional customer selector, the payment capture and its exact-sum guard, and
  the completion outcome mapping.
- `apps/web/src/app/api/sales/[[...path]]/route.test.ts` and the cash proxy test
  — the cookie-only forwarding, the allowlisted query and body rebuild, the
  unknown-key rejection, the tenant-authority rejection and the rejection-state
  contract, mirroring the EPIC-11 staff-proxy coverage.
- The UX-only permission and entitlement branch assertions: a hidden affordance
  with the backend still enforcing the permission and the capability.

## Known Limitations

- None yet; nothing is implemented.
- Planned: with the barcode deferred ([[DEC-025]], [[TD-019]]), item
  identification depends on a name search and is not scanner-reliable.
- Planned: the surface has no offline mode and no local queue, so a network
  failure blocks a sale rather than buffering it. That is a deliberate boundary,
  not a deferred defect.
- Planned: E2E browser coverage is tracked separately, so this Story plans
  component and proxy tests rather than a Playwright suite.

## Technical Debt

- [[TD-019]] records the deferred barcode/SKU identification ([[DEC-025]]); this
  Story is the slice that exposes the gap to staff.
- [[TD-018]] records the deferred sale reversal and payment refund
  ([[DEC-023]]); the surface ships no correction affordance.
- [[TD-013]] records the existing staff-proxy rejection inconsistency; the POS
  proxies must follow the documented contract and must not add a third
  divergence.
- No new debt record is planned.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-27):
  - [[DEC-022]] — the reference price is a suggestion the POS pre-fills, and the
    operator override is the only price adjustment.
  - [[DEC-025]] — item identification by name through the existing read API,
    with the barcode deferred and the scanner gap recorded.
  - [[DEC-026]] — the sales and cash permission keys and the `sales` entitlement
    gate, consumed here as UX gates only.
  - [[DEC-028]] — the optional customer, no discount and no clinical links.
  - [[DEC-029]] — the payment composition and the exact-sum rule the capture
    must enforce client-side and the API enforces authoritatively.
  - [[DEC-023]] — the deferred reversal boundary; the surface offers no
    correction affordance.
- An ADR is not expected: the surface introduces no architecture change that the
  complexity budget gates.

## Resolved by Decision

- **Item identification** — [[DEC-025]]: resolve by name through the shipped
  catalog read API; no code column and no scanner claim.
- **Price entry** — [[DEC-022]]: pre-fill the reference price, allow the
  override, record the applied price.
- **Customer selection** — [[DEC-028]]: optional and non-blocking.
- **Payment capture** — [[DEC-029]]: several payments across the six methods
  summing exactly, with no change or credit field.
- **Permission and entitlement gates** — [[DEC-026]]: UX only, with the backend
  checks mandatory.
- **The exact page composition, the state copy and the client module layout** —
  an implementation choice inside approved scope, decided during the slice using
  the sibling staff surfaces as precedent.

## Files / Modules

- `apps/web/src/app/api/sales/[[...path]]/route.ts` — the sales proxy.
- `apps/web/src/app/api/cash/[[...path]]/route.ts` — the cash proxy.
- `apps/web/src/app/(app)/app/sales/` — the POS pages.
- `apps/web/src/app/(app)/app/sales/` — client modules, schemas and query
  helpers, colocated with the pages.
- `docs/08-tech-debt/TD-019-pos-item-code-identification-deferred.md` — the
  recorded identification gap.
- `docs/01-roadmap/EPIC-12-POS-Payments.md` — the epic record.

## Completion Notes

_Status must remain non-done until all required gates pass._ This Story stays
`planned` while nothing exists; it may not be marked `done` until the proxies,
the pages, the state coverage and the client tests are merged with the required
CI checks green.
