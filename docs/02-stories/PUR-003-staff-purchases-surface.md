---
id: PUR-003
type: story
title: Staff purchases surface
epic: EPIC-11
status: planned
priority: medium
depends_on:
  - SUP-001
  - PUR-001
  - PUR-002
prd_sections:
  - "7"
  - "9"
  - "17"
  - "29"
  - "41"
created: 2026-09-26
updated: 2026-09-26
---

# PUR-003 — Staff purchases surface

## Objective

Deliver the authenticated staff browser surface for suppliers and purchases: a
route-handler proxy that forwards only the allowlisted supplier and purchase
pairs to the API, and the client pages that let staff work a purchase from draft
to received — list, create, edit, cancel and receive — with loading, empty,
error, success and permission-denied states.

This Story owns presentation and transport only. It holds no business logic, no
authorization authority and no stock arithmetic.

## Context

- Sibling staff surfaces set the precedent this Story reuses: the `/app/catalog`
  pages behind an `/api/catalog/[...path]` proxy, the `(method, path-shape)`
  allowlist, cookie-only forwarding, and the API's own
  `{ error: { code, message } }` envelope preserved to the client.
- [[TD-013]] records the existing proxy rejection inconsistencies (a known path
  with a disallowed method, an unknown path, a malformed path and a missing
  session each diverge across the sibling proxies). This Story must follow the
  documented contract rather than replicating a divergence, and must not
  silently widen TD-013.
- Permission gates in the UI are UX only. Backend enforcement is mandatory, and
  a `403` from the API must render a permission-denied state rather than being
  hidden or retried.
- Reusable components consume semantic design tokens; no project-specific brand
  literal, no tenant CSS or JavaScript injection, and no arbitrary remote font
  enters this surface.
- Supplier contact data is CONFIDENTIAL per [[DEC-011]], so the surface must not
  log payloads and must not place unclassified supplier data in client-visible
  telemetry.

## In Scope

- `apps/web` — route handlers under `/api/suppliers/[...path]` and
  `/api/purchases/[...path]` with a strict `(method, path-shape)` allowlist,
  cookie-only forwarding and the API envelope preserved.
- Supplier pages: list, read-only detail, create/edit and deactivate.
- Purchase pages: list, create/edit draft, cancel, and the receive affordance
  with its confirmation and result states.
- TanStack Query hooks for the list/detail/mutation flows, with cache
  invalidation after each accepted mutation.
- Loading, empty, error, success and permission-denied states on every page and
  every mutation, including a `409` conflict presentation for a rejected
  transition.
- Component and route-handler tests.
- This Story and the epic record.

## Out of Scope

- **Any API, schema or business rule.** The endpoints, contracts and gates are
  owned by [[SUP-001]], [[PUR-001]] and [[PUR-002]]; this Story consumes them.
- **Dashboard, low-stock or purchasing analytics** — [[EPIC-18]].
- **Cash, POS, invoices, fiscal documents and payments** — [[EPIC-12]] through
  [[EPIC-16]].
- **Supplier portal or any customer-portal exposure.** The portal is a separate
  security boundary and holders gain no staff access.
- **Imports** — [[EPIC-19]].
- **A barcode/scanning or keyboard-optimized POS-style receive flow** —
  [[EPIC-12]].
- **Resolving [[TD-013]].** This Story must not introduce a new divergence and
  must not close that record by assumption.

## Acceptance Criteria

- [ ] The `/api/suppliers` and `/api/purchases` proxies allow exactly the
      documented `(method, path-shape)` pairs the API exposes, forward only the
      staff session cookie, and return the API's own
      `{ error: { code, message } }` envelope for a known path with a disallowed
      method, an unknown path, a malformed path and a missing session.
- [ ] The proxy performs no authorization of its own and adds no header that the
      API would trust as tenant or permission context; tenant identity stays
      server-resolved.
- [ ] Supplier pages implement list, detail, create/edit and explicit
      deactivate, with no delete affordance anywhere.
- [ ] Purchase pages implement list, draft create/edit, explicit cancel and the
      explicit receive action; no page writes a status field directly.
- [ ] Receiving is guarded by an explicit confirmation and renders the distinct
      outcomes: success (the purchase is `RECEIVED`), `409` conflict (already
      received or cancelled), `403` forbidden, `404` not found and a transport
      error — each visually distinct, with no silent retry of a transition.
- [ ] Every list and detail page has loading, empty, error, success and
      permission-denied states; mutations expose pending, success and error
      feedback.
- [ ] A `403` renders a permission-denied state instead of an empty list or a
      generic failure, and permission checks never gate a mutation without the
      backend check behind it.
- [ ] All reusable components consume semantic design tokens; no
      Veterinary-specific or hardcoded brand color, logo, radius or font is
      introduced, and no arbitrary tenant CSS or JavaScript is accepted.
- [ ] Supplier contact and identifier fields are not written to client logs,
      error telemetry or analytics payloads; the classification from [[SUP-001]]
      is honored in the UI.
- [ ] Cache invalidation runs after each accepted mutation so a list or detail
      view never shows stale draft or status data.
- [ ] Component and route-handler tests cover the allowlist pairs, the envelope
      preservation, the permission-denied state and each mutation outcome.
- [ ] Required lint/typecheck/test/build checks pass.

## Domain Invariants

- **The UI is not an authority.** Every gate this surface renders is re-checked
  by the backend; hiding or showing a control never grants access.
- **No business rule lives in the browser.** The surface sends the documented
  contract and renders the API's answer; it computes no stock, cost, tax or
  numbering.
- **Branding is layered.** Components consume semantic tokens resolved from
  tenant branding over the product preset over core defaults; no literal brand
  value is embedded.
- **Sensitive data does not leak.** Supplier and purchase payloads are not
  logged or exported client-side, and no portal surface receives them.

## API

### Added

```text
None yet (web transport only). The proxy pairs depend on the routes fixed by
[[SUP-001]], [[PUR-001]] and [[PUR-002]]; no route is implemented yet.
```

### Changed

```text
None yet. Existing staff proxies are unchanged, and TD-013 stays open.
```

## Database

### Migration

```text
None. This Story owns no persistence.
```

### Models/Tables

- None. This Story reads and writes only through the API.

## UI

- Supplier list, detail, create/edit and deactivate under the staff shell.
- Purchase list, draft create/edit, cancel and receive under the staff shell.
- Loading, empty, error, success and permission-denied states on every page and
  mutation, plus a distinct `409` conflict presentation for a rejected
  transition.
- Reusable components use semantic branding tokens rather than project-specific
  literals.

## Implementation Summary

_Not implemented. The Decision records this Story consumes are accepted as of
2026-09-26 — [[DEC-016]] suppliers/purchases permission keys, role matrix and
entitlement gating plus the accepted outcomes of [[DEC-011]], [[DEC-012]],
[[DEC-013]], [[DEC-014]], [[DEC-015]] and [[DEC-017]] — and the slice awaits
implementation authorization, which also depends on the API stories it
consumes._

## Verification

```text
Not run.
```

## Tests Added

- None yet. Planned: route-handler tests for the allowlist pairs, the
  cookie-only forwarding and the four rejection modes with the API envelope
  preserved; component tests for list/detail/create/edit/deactivate, the draft
  flow and the receive confirmation; and state tests for loading, empty, error,
  success, permission-denied and `409` conflict.

## Known Limitations

- None recorded; the Story is unimplemented.

## Technical Debt

- None created. This Story must follow the documented proxy contract instead of
  replicating the divergences recorded in [[TD-013]]; if a new divergence is
  unavoidable, it is recorded as debt rather than hidden.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-26):
  - [[DEC-016]] — suppliers/purchases permission keys, role matrix and
    entitlement gating, which fixes the permission keys and the role matrix this
    surface renders as UX gates only, and the absence of an entitlement gate.
  - [[DEC-011]] supplier identity, uniqueness and classification, [[DEC-012]]
    purchase aggregate shape and the draft-versus-receive validation gate,
    [[DEC-013]] purchase line cost and tax structure, [[DEC-014]] purchase
    receiving semantics — single-shot transition, all-or-nothing line gates and
    deterministic lock order, [[DEC-015]] purchase cancellation and the
    correction boundary for a received purchase and [[DEC-017]]
    suppliers/purchases audit scope — the accepted outcomes of the API stories
    this surface consumes.
- No ADR is expected: this Story introduces no architecture change.

## Resolved by Decision

None. This Story owns presentation and transport only, and the Decision records
it consumes — [[DEC-016]] suppliers/purchases permission keys, role matrix and
entitlement gating plus the accepted outcomes of [[DEC-011]], [[DEC-012]],
[[DEC-013]], [[DEC-014]], [[DEC-015]] and [[DEC-017]] — are accepted as of
2026-09-26 and fix the API contract and the permission gates it renders.

## Open implementation details (inside approved scope)

The items below are presentation choices inside approved scope, decided during
this Story's implementation using the sibling staff surfaces as precedent. They
are implementation choices inside approved scope rather than open product
decisions, and no Decision record is required for them.

1. **Screens and fields.** The concrete supplier and purchase screens, the
   columns and filters for each list, and the fields on the draft form.
2. **Receive affordance placement.** Is receiving a row action from the list, a
   detail-page action, or both, and does it need a line-level quantity
   confirmation screen?
3. **Navigation and shell integration.** Whether suppliers and purchases appear
   as separate staff nav entries, and which entitlement or permission gates the
   nav item.
4. **Conflict presentation.** The exact copy and retry affordance for a `409` on
   receive versus a `409` on a draft edit.
5. **Cancel confirmation.** Whether cancelling a draft requires a typed
   confirmation or a simple dialog.

## Files / Modules

- `apps/web/app/api/suppliers/[...path]/route.ts` — the supplier proxy.
- `apps/web/app/api/purchases/[...path]/route.ts` — the purchase proxy.
- `apps/web/app/app/suppliers/` — the supplier pages.
- `apps/web/app/app/purchases/` — the purchase pages.
- `apps/web/src/features/suppliers/` and `apps/web/src/features/purchases/` —
  client modules, schemas and TanStack Query hooks.
- `docs/01-roadmap/EPIC-11-Suppliers-Purchases.md` — the epic record.

## Completion Notes

_Status must remain non-done until all required gates pass and the API stories
it depends on are implemented._
