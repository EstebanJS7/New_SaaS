---
id: PUR-003
type: story
title: Staff purchases surface
epic: EPIC-11
status: done
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
branch: feat/epic-11-staff-purchases
created: 2026-09-26
updated: 2026-09-27
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

- [x] The `/api/suppliers` and `/api/purchases` proxies allow exactly the
      documented `(method, path-shape)` pairs the API exposes, forward only the
      staff session cookie, and return the API's own
      `{ error: { code, message } }` envelope for a known path with a disallowed
      method, an unknown path, a malformed path and a missing session. Evidence:
      the method-aware allowlists in both `route.ts` handlers and their route
      tests (14 tests each) assert every served pair, the
      `405`/`404`/`400`/`401` rejection envelopes, and the byte-equivalent
      preservation of an upstream `400`, `403`, `404` and `409`.
- [x] The proxy performs no authorization of its own and adds no header that the
      API would trust as tenant or permission context; tenant identity stays
      server-resolved. Evidence: the header allowlist forwards only the staff
      session cookie and `x-request-id` (plus a JSON `content-type` on a
      mutating verb), the route tests assert exactly those keys, a brokered
      portal-only cookie is `401` and the portal cookie is never forwarded even
      when the browser holds both sessions, and no tenant/role/permission header
      is synthesized.
- [x] Supplier pages implement list, detail, create/edit and explicit
      deactivate, with no delete affordance anywhere. Evidence:
      `suppliers-list.tsx`, `[id]/supplier-detail.tsx`, `new/page.tsx`,
      `[id]/edit/page.tsx` and the shared `supplier-form.tsx`; the list and edit
      tests assert no delete affordance and the form offers no `isActive`
      control.
- [x] Purchase pages implement list, draft create/edit, explicit cancel and the
      explicit receive action; no page writes a status field directly. Evidence:
      `purchases-list.tsx`, `[id]/purchase-detail.tsx`, `new/page.tsx`,
      `[id]/edit/page.tsx` and the shared `purchase-form.tsx`; the form and list
      tests assert no status control and the detail offers Edit/Cancel/Receive
      only while the purchase is `DRAFT`.
- [x] Receiving is guarded by an explicit confirmation and renders the distinct
      outcomes — success (the purchase is `RECEIVED`), the non-draft `409`, the
      inactive-item `409`, the non-tracking-item `409`, `403` forbidden, `404`
      not found and a transport error — each visually distinct, with no silent
      retry of a transition. Evidence: `receiveErrorTitle` and the confirmation
      in `purchase-detail.tsx`, and the detail tests covering each of the seven
      outcomes plus "never retries a failed receive silently".
- [x] Every list and detail page has loading, empty, error, success and
      permission-denied states; mutations expose pending, success and error
      feedback. Evidence: the loading/empty/error/permission-denied branches and
      the rendered success view in the list and detail components, the pending
      disabled form state, the mutation error alerts, the receive success region
      and the post-mutation cache updates and redirects.
- [x] A `403` renders a permission-denied state instead of an empty list or a
      generic failure, and permission checks never gate a mutation without the
      backend check behind it. Evidence: `isSupplierPermissionDenied` /
      `isPurchasePermissionDenied` render the permission-denied branch, there is
      no client-side permission gate on any page or nav entry, and the client
      modules document the backend as the authority.
- [x] All reusable components consume semantic design tokens; no
      Veterinary-specific or hardcoded brand color, logo, radius or font is
      introduced, and no arbitrary tenant CSS or JavaScript is accepted.
      Evidence: every page and form composes `@newsaas/ui` `Button`/`Card` and
      semantic Tailwind tokens (`bg-card`, `text-muted-foreground`,
      `border-destructive`, `bg-muted`, `text-primary`, `border-input`); no
      literal brand value, inline style, injected stylesheet or remote font
      appears in the slice.
- [x] Supplier contact and identifier fields are not written to client logs,
      error telemetry or analytics payloads; the classification from [[SUP-001]]
      is honored in the UI. Evidence: the client module documents the
      CONFIDENTIAL classification and both `suppliers-api.test.ts` and
      `purchases-api.test.ts` assert that no payload reaches the console on
      success or conflict; the `409` copy is the API's own value-free message.
- [x] Cache invalidation runs after each accepted mutation so a list or detail
      view never shows stale draft or status data. Evidence: every mutation's
      `onSuccess` calls `setQueryData` for the detail and `invalidateQueries`
      for the list, and the list/detail tests observe the refreshed data after a
      mutation.
- [x] Component and route-handler tests cover the allowlist pairs, the envelope
      preservation, the permission-denied state and each mutation outcome.
      Evidence: **149 tests across 12 new files** (two route-handler suites, two
      client suites, four list/form suites and four page suites), plus the
      reconciled `nav-sidebar.test.tsx`.
- [x] Required lint/typecheck/test/build checks pass. Evidence: `pnpm lint`
      14/14, `pnpm typecheck` 14/14, `pnpm build` 9/9, `pnpm test` 15/15,
      `pnpm format-check` clean, and the merged CI run `36305211468` on head
      `ae08e88` with `Database migrations` and `Lint, Typecheck, Test, Build`
      both `SUCCESS`.

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
None. This Story adds no HTTP route to the private API: it ships two Next.js
route handlers in `apps/web` that transport to the routes [[SUP-001]],
[[PUR-001]] and [[PUR-002]] already fixed.
```

### Changed

```text
None at the API. The two new staff proxies are additive web surfaces; the
existing staff proxies (scheduling, portal, catalog) are unchanged, and
[[TD-013]] stays open.
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

The staff purchases surface is implemented on branch
`feat/epic-11-staff-purchases` (merged as `e12ac1f`; see Verification).

**Transport.** Two Next.js route handlers expose the shipped API to the browser
behind a strict `(method, path-shape)` allowlist and refuse everything else
before any upstream call:

- `apps/web/src/app/api/suppliers/[[...path]]/route.ts` — `GET` list and item,
  `POST` list and `:id/deactivate`, `PUT` item.
- `apps/web/src/app/api/purchases/[[...path]]/route.ts` — `GET` list and item,
  `POST` list, `:id/cancel` and `:id/receive`, `PUT` item.

`PATCH` and `DELETE` are absent from both surfaces, the lifecycle status is
never forwarded as a writable field, and a `GET` list is the only shape that
accepts a query — its single contract key (`isActive` for suppliers, `status`
for purchases) rebuilt from the allowlist so an unknown key cannot become a
query tunnel. The rejection contract is uniform and uses the API's own
`{ error: { code, message } }` envelope: `404 NOT_FOUND` for a route the API
does not expose, `405 METHOD_NOT_ALLOWED` (no `Allow` header, so methods cannot
be enumerated) for a known path reached with the wrong method,
`400 VALIDATION_FAILED` for a malformed path (percent escape, empty segment, `.`
or `..`), and `401 UNAUTHENTICATED` for a missing staff session. A forwarded
response preserves the upstream status, body, `content-type` and `x-request-id`
byte-equivalently, so the API's `400`, `403`, `404` and stable `409` reach the
browser unchanged. Browser headers cross a strict allowlist: only the staff
session cookie (read server-side by name) and `x-request-id`, plus a JSON
`content-type` on a mutating verb. No tenant, role or permission header is
synthesized, the portal cookie is never forwarded, and the proxy resolves no
tenant and performs no authorization of its own — the API stays the only
authority, so a cross-tenant id is the API's own `404`. A mutating body is piped
as the caller's raw `ReadableStream`, never buffered, so the API's Zod
validation sees the exact input.

**Client modules.** `apps/web/src/app/(app)/app/suppliers/suppliers-api.ts` and
`.../purchases/purchases-api.ts` wrap the proxies in TanStack Query-friendly
calls. Each throws one `ApiRequestError` carrying the API's stable `code` and
`status`, and classifies the refusals the surface must render apart: `FORBIDDEN`
as permission denied, `NOT_FOUND` as the shared not-found, and, for purchases,
`CONFLICT` split into the non-draft mutability rule and the two reused EPIC-10
line-gate messages — plus a transport failure that never reached the API.
Neither module sends a `status`, neither has a delete call, and neither writes a
supplier or purchase payload to the console, an error tracker or an analytics
event ([[DEC-011]], [[DEC-012]], [[DEC-013]]).

**Supplier pages.** `suppliers-list.tsx`, the read-only `supplier-detail.tsx`
and the shared create/edit `supplier-form.tsx` (with their `page.tsx` route
wrappers) ship list, detail, create/edit and the explicit deactivate command.
The list defaults to active-only and can include deactivated suppliers; removal
is the confirm-guarded `POST /suppliers/:id/deactivate`, and there is no delete
affordance anywhere. The form sends the required name, maps an emptied optional
field to `null` and an unchanged field to an omitted key, and offers no
`isActive` control, so `suppliers.update` can never change the lifecycle.

**Purchase pages.** `purchases-list.tsx`, `purchase-detail.tsx`, the shared
create/edit `purchase-form.tsx` and their wrappers ship the list with its
lifecycle filter, the draft create/edit form that edits the full line set (add,
change, remove a line; the submitted set is authoritative), the explicit cancel
command and the explicit receive affordance. No page writes a status field and
no page offers a delete: the transitions are the API's own commands, offered
only while the purchase is `DRAFT`.

**Receive flow.** Receiving is guarded by an explicit confirmation that states
it writes stock and cannot be undone by editing, and it is single-shot: the
detail page never retries a transition on its own and renders seven distinct
outcomes — success (the purchase is `RECEIVED`), the non-draft `409`, the
inactive-item `409`, the non-tracking-item `409`, `403` permission denied, `404`
not found and a transport error — each with its own heading and copy, with the
non-draft conflict presented as terminal rather than transient. The three `409`
conditions share the API's `CONFLICT` code and are distinguished by the API's
stable, value-free message, never by a value echoed from the store.

**Navigation.** `nav-sidebar.tsx` adds `Suppliers` (`/app/suppliers`) and
`Purchases` (`/app/purchases`) as real `next/link` destinations, declared and
gated exactly like the shipped entries: a plain link with no client-side
permission gate, because the API answers `403` on its own.

**State coverage.** Every list and detail page renders loading, empty (lists),
error, permission-denied and success states, and each mutation exposes pending,
success and error feedback. A `403` renders a permission-denied state rather
than an empty list or a generic failure, and the surface adds no client-side
gate the backend does not also enforce. Purchases and suppliers reference
related records by id, so the surface resolves display names read-only through
the existing supplier and catalog clients and degrades to a short id fragment
when a referenced record is unreadable. All components consume semantic design
tokens only; no brand literal, tenant CSS, JavaScript injection or remote font
enters the surface.

**No contract changed.** This Story adds no API route, no schema model, no
migration, no seed entry and no permission key. It consumes the contracts
[[SUP-001]], [[PUR-001]] and [[PUR-002]] already shipped.

## Verification

```text
pnpm --filter @newsaas/web test
  → 60 files, 638 passing tests (the suite held 489 before this Story; the
    12 new test files contribute 149 tests).

pnpm lint         → 14/14 tasks
pnpm typecheck    → 14/14 tasks
pnpm build        → 9/9 tasks
pnpm format-check → clean
pnpm test         → 15/15 tasks
```

**Delivery (merged).** The work units are merged into `main` through pull
request #73 (`feat(EPIC-11): implement the staff purchases surface (PUR-003)`)
as merge commit `e12ac1f` (`e12ac1ffd96928a45a333f0e4722e2486aa16274`), merged
`2026-09-27T08:12:47Z`. The required CI checks are green on the evaluated head
commit `ae08e88` (`ae08e88b5d2a582e00927eb6a0a00fbac1200810`): CI run
`36305211468` concluded `success`, with `Database migrations` and
`Lint, Typecheck, Test, Build` both `SUCCESS`. The merged CI receipt is recorded
in `docs/10-qa/CI-EVIDENCE.md`.

The epic's live-PostgreSQL suite (71 cases) runs inside that
`Database migrations` job on every pull request, so the receiving evidence is
machine-verified rather than local-only.

Not run: the two proxies are exercised against mocked API envelopes, and no
live-API run is recorded for this slice; see Known Limitations.

## Tests Added

149 tests across 12 new files, plus the navigation reconciliation:

- `apps/web/src/app/api/suppliers/[[...path]]/route.test.ts` — **14 tests**: the
  served pairs, the query policy, the method refusal, the unknown/malformed path
  rejection, the cookie-only header allowlist, the portal-cookie refusal, the
  raw-stream body and the upstream envelope preservation.
- `apps/web/src/app/api/purchases/[[...path]]/route.test.ts` — **14 tests**: the
  same contract for the purchase surface, including `cancel` and `receive`.
- `apps/web/src/app/(app)/app/suppliers/suppliers-api.test.ts` — **14 tests**:
  the verb/path of each call, the filter serialization, the error classification
  and the no-console guarantee.
- `apps/web/src/app/(app)/app/suppliers/suppliers-list.test.tsx` — **12 tests**:
  loading, both empty states, permission-denied, the filter default, the
  deactivate command and the absence of a delete affordance.
- `apps/web/src/app/(app)/app/suppliers/supplier-form.test.tsx` — **12 tests**:
  absent-versus-null semantics, the required name, the duplicate-identifier
  conflict, the pending state and the absence of an `isActive` control.
- `apps/web/src/app/(app)/app/suppliers/[id]/supplier-detail.test.tsx` — **7
  tests**: the read-only view, the inactive/absent-field rendering, the
  permission-denied and not-found states, loading and the no-console guarantee.
- `apps/web/src/app/(app)/app/suppliers/supplier-pages.test.tsx` — **10 tests**:
  the create/edit route flows, their pending, `403`, `400`, `404` and `409`
  mutation states and the absence of a delete affordance.
- `apps/web/src/app/(app)/app/purchases/purchases-api.test.ts` — **15 tests**:
  the verb/path of each call, the three distinguishable `409` conditions, the
  transport classification and the no-console guarantee.
- `apps/web/src/app/(app)/app/purchases/purchases-list.test.tsx` — **10 tests**:
  loading, both empty states, permission-denied, the filter, the resolved
  supplier name, the id-fragment degradation and the draft-only Edit affordance.
- `apps/web/src/app/(app)/app/purchases/purchase-form.test.tsx` — **14 tests**:
  the exact-decimal payloads, adding and removing lines, the last-line guard,
  the required-field checks, the non-draft `409`, the pending state and the
  absence of a status control.
- `apps/web/src/app/(app)/app/purchases/[id]/purchase-detail.test.tsx` — **17
  tests**: loading, permission-denied, not-found, the resolved display names,
  the declined and accepted receive confirmations, each of the seven receive
  outcomes, no silent retry, the explicit cancel and the absence of a
  delete/status affordance.
- `apps/web/src/app/(app)/app/purchases/purchase-pages.test.tsx` — **10 tests**:
  the create/edit route flows, their pending, `403`, `400`, `404` and `409`
  states and the absence of a delete affordance.
- `apps/web/src/components/shell/nav-sidebar.test.tsx` — **reconciled** (2
  existing tests, not new): the sidebar now asserts 9 entries and 6 real links,
  with `Suppliers` and `Purchases` before `Agenda`.

## Known Limitations

- **The staff proxies are exercised against mocked API envelopes.** The route
  tests drive a mocked `fetch`; no live API was run for this slice, so a real
  browser-to-API round trip through the proxies is not covered here. Playwright
  E2E coverage remains deferred ([[TD-007]]).
- **Display names are resolved by reading the supplier and catalog lists.** A
  purchase line and supplier reference carry only ids, and no name-resolution
  endpoint exists, so the surface reads the existing read-only lists and builds
  a map; on a large tenant that is a heavier read than a dedicated lookup, and
  when a referenced record is not readable the surface degrades to a short id
  fragment (`#`) instead of a name.
- **The three `409` conflicts are distinguished by the API's stable message, not
  a machine code.** All three share the `CONFLICT` code, so the client compares
  the API's value-free message constants. A future message change would require
  the client constants to move with it; a per-condition code would be a stronger
  contract.
- **The surface is a UX layer only.** Permission gates and feature gating are
  not enforced here; the backend remains the sole authority, and there is no
  entitlement gate on purchases ([[DEC-016]]).
- **No human-readable purchase number.** By design ([[DEC-018]]), a purchase is
  identified by a short id fragment plus its supplier and date, so the staff
  surface shows `Purchase #<short id>` rather than a business number.
- **The receive confirmation is a browser `window.confirm`.** It is explicit and
  blocking, but it is not a bespoke dialog with typed confirmation; the surface
  relies on the API's single-shot command and stable `409` for correctness.

## Technical Debt

- **No new debt record is created by this Story.**
- **[[TD-013]] stays open, and its trigger has fired.** The epic added the next
  two staff proxies, and both follow the documented rejection contract rather
  than reproducing a sibling divergence. They do, however, duplicate the
  handler's shape classification instead of sharing a helper, because the shared
  library was outside this slice's edit surfaces. That duplication is exactly
  what [[TD-013]] proposes to remove, so the record is updated with this call
  site and stays **open** — it is not closed by assumption.

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

Done for **implementation, verification and delivery scope**: the two proxies,
both client modules, the supplier and purchase pages, the receive flow with its
seven distinct outcomes, the navigation entries and the state coverage are all
in place and tested, and the checks this slice can run are green. The work units
are merged into `main` through pull request #73 as merge commit `e12ac1f`, with
the required CI checks green on head `ae08e88` (run `36305211468`;
`Database migrations` and `Lint, Typecheck, Test, Build` both `SUCCESS`).

This is **not** a production-readiness statement and it is not a release or a
deployment: the live-API round trip and the Playwright E2E remains outstanding,
and the open Tech Debt above remains.
