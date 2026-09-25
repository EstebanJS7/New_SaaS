---
id: CAT-004
type: story
title: Staff catalog surface
epic: EPIC-09
status: in-progress
priority: high
depends_on:
  - EPIC-02
  - CAT-001
  - CAT-002
  - CAT-003
prd_sections:
  - "7"
  - "15"
permissions:
  - catalog.read
  - catalog.create
  - catalog.update
  - catalog.deactivate
branch: main
created: 2026-09-25
updated: 2026-09-25
---

# CAT-004 — Staff catalog surface

## Objective

Make the WU2 catalog API reachable from the staff browser: an authenticated web
proxy at `/api/catalog` with a strict `(method, path-shape)` allowlist that
forwards only the staff session cookie, and the client API module the catalog
pages will call. This slice is transport only — no page, component, form or
sidebar entry — so the presentation unit (B2) starts from a proven, allowlisted
boundary instead of inventing one.

## What shipped

| Surface (web)                      | Upstream (API)                 | Forwarded by                  |
| ---------------------------------- | ------------------------------ | ----------------------------- |
| `GET /api/catalog`                 | `GET /catalog`                 | `listCatalogItems(filters)`   |
| `GET /api/catalog/:id`             | `GET /catalog/:id`             | `getCatalogItem(id)`          |
| `GET /api/catalog/tax-rates`       | `GET /catalog/tax-rates`       | `listTaxRates()`              |
| `POST /api/catalog`                | `POST /catalog`                | `createCatalogItem(body)`     |
| `PUT /api/catalog/:id`             | `PUT /catalog/:id`             | `updateCatalogItem(id, body)` |
| `POST /api/catalog/:id/deactivate` | `POST /catalog/:id/deactivate` | `deactivateCatalogItem(id)`   |

That is the whole reachable surface: the six routes WU2 shipped, and nothing
else. There is no `DELETE`, no `PATCH`, no rate mutation, and no agenda service
filter (epic WU4).

## Staff presentation (WU3 B2)

The catalog is now reachable from the staff shell, under the same server-page +
client-component convention the `customers` and `patients` folders use.

| Route                   | Component                                                                         |
| ----------------------- | --------------------------------------------------------------------------------- |
| `/app/catalog`          | `CatalogList` — kind filter, active-by-default status filter, per-item deactivate |
| `/app/catalog/new`      | `CatalogForm` in create mode                                                      |
| `/app/catalog/:id`      | `CatalogItemDetail` — read-only identity, kind, rate, price and status            |
| `/app/catalog/:id/edit` | `CatalogForm` in edit mode                                                        |

| Required state    | How it is presented                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading           | An explicit "Loading catalog items..." card (and an explicit edit/detail-page loading line) while the query is pending.                                        |
| Empty             | "No active catalog items" by default, "No catalog items yet" once deactivated items are included, "No items match these filters" when a kind filter is active. |
| Error             | The mapped API error envelope in a `role="alert"` block; the server message is kept for unmapped codes.                                                        |
| Permission-denied | `403 FORBIDDEN` adds a `Permission denied` heading and the mapped copy; `403 FEATURE_NOT_ENTITLED` keeps the entitlement copy instead of inventing a cause.    |
| Success           | A successful create/edit invalidates the list query and routes back to `/app/catalog`; a successful deactivate refetches the list.                             |

| Control            | Behavior                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Kind filter        | `All kinds` plus the four pinned kinds, sent as the API's `kind` key.                                                          |
| Status filter      | Defaults to ACTIVE (`isActive=true`); the visible "Include deactivated items" checkbox drops the filter so retired items show. |
| Tax rate selector  | Required, populated from `GET /catalog/tax-rates`; the form cannot be submitted while it is empty.                             |
| Rate display order | The selector re-orders the fetched list for display only (`EXEMPT`, `IVA_5`, `IVA_10`); the API keeps its `code` order.        |
| Reference price    | Optional amount plus currency; PYG is the default and the selector offers only `PYG`/`USD` (the client constant).              |
| Deactivate         | Only the explicit `POST /catalog/:id/deactivate` command, behind a confirmation; no hard delete and no generic status edit.    |

The item name opens the read-only detail route `/app/catalog/:id`, so a role
that holds only `catalog.read` can inspect an item instead of landing in a form
it cannot submit. `Edit` stays a separate, explicit destination and is never
hidden behind a client-side permission guess: the API refuses the write and the
form surfaces that `403` honestly. The detail page reuses the existing
`catalog-api.ts` client unchanged, mutates nothing and offers no deactivate
command of its own.

The GLOBAL rate list arrives ordered by `code`, which is lexicographic and
therefore `EXEMPT`, `IVA_10`, `IVA_5`. The presentation layer re-orders it to
the human order `EXEMPT`, `IVA_5`, `IVA_10` with `sortTaxRatesForDisplay`, a
presentation rule that changes no API response, seed row or stored value.

Everything is styled with semantic design tokens (`bg-card`,
`text-muted-foreground`, `border-destructive`, `focus-visible:ring-ring`, ...).
No brand literal is introduced. Permission checks remain UX-only: the API
answers `403` when the role does not hold `catalog.read` / `catalog.create` /
`catalog.update` / `catalog.deactivate`, and the pages merely surface it
honestly.

## Rejection contract (the proxy's security boundary)

| Request                                             | Result                            | Upstream call |
| --------------------------------------------------- | --------------------------------- | ------------- |
| Allowlisted pair, staff cookie present              | forwarded verbatim to `/catalog…` | yes           |
| Known path, method the API does not expose          | `405 METHOD_NOT_ALLOWED`          | no            |
| Unknown path (extra/unknown segment, bad UUID)      | `404 NOT_FOUND`                   | no            |
| Malformed path (`%` escape, empty/`.`/`..` segment) | `400 VALIDATION_FAILED`           | no            |
| Unknown query key, or any query off the list read   | `404 NOT_FOUND`                   | no            |
| No staff session (only a portal cookie, or none)    | `401 UNAUTHENTICATED`             | no            |

Every rejection uses the API's own `{ error: { code, message } }` envelope, so a
caller cannot tell a proxy refusal from an API refusal by shape.

## Context

- WU2 ([[CAT-002 Catalog read API]], [[CAT-003 Catalog write API]]) shipped the
  six routes, the four granular permissions, the allowlisted INTERNAL DTOs and
  the transactional audit. Nothing browser-facing exists yet: there is no
  `/api/catalog` proxy and no page under `/app/catalog`, so `customers`,
  `patients` and `agenda` remain the only real staff destinations.
- Precedents reused: `apps/web/src/app/api/scheduling/[[...path]]/route.ts` for
  the allowlist shape, the query rebuild and the raw-stream body forwarding;
  `apps/web/src/app/api/portal/[[...path]]/route.ts` for the method-independent
  shape classification, the uniform method refusal and the query policy;
  `apps/web/src/lib/session-cookie.ts` for the two cookie families;
  `patients-api.ts` for the client idiom (`ApiRequestError`, `getJson`/
  `postJson`/`putJson`, the `userFacing*Error` mapping).

## In Scope

- `apps/web/src/app/api/catalog/[[...path]]/route.ts` — the authenticated proxy,
  the strict allowlist, the cookie forwarding and the rejection envelopes.
- `apps/web/src/app/api/catalog/[[...path]]/route.test.ts` — the allowlist from
  both sides, with a mocked fetch and no live server.
- `apps/web/src/app/(app)/app/catalog/catalog-api.ts` — the client module for
  the list (with the kind and status filters), item detail, the rate list,
  create, update and deactivate.
- `apps/web/src/app/(app)/app/catalog/catalog-api.test.ts` — the transport
  contract of that module.
- This Story.

## Out of Scope

- **WU3 B3 checks and WU4/WU5** — the unit-wide check run (B3), the
  `SERVICE`↔`Appointment` association and agenda filter (WU4), and live
  PostgreSQL and closure evidence (WU5). The B2 presentation below IS delivered
  by this Story, after the transport slice.
- Rate editing (rates are global and read-only), the `SERVICE`↔`Appointment`
  association and the agenda filter (WU4), live-PostgreSQL and closure evidence
  (WU5).
- Any stock, POS, invoice, fiscal or tax arithmetic anywhere in the browser.
- Changing any API file, permission, schema, migration or seed.

## Acceptance Criteria

- [x] The proxy forwards only the six allowlisted `(method, path-shape)` pairs,
      only the staff session cookie, and never an arbitrary path, method or
      query; a known path with a disallowed method is refused with the uniform
      method rejection and an unknown path keeps the not-found envelope.
- [x] The portal cookie is never read or forwarded, and a request whose only
      credential is a portal cookie is refused before any upstream call.
- [x] The client module covers list with the `kind` and `isActive` filters, item
      detail, the rate list, create, update and deactivate, normalizing failures
      into `ApiRequestError` with the stable code and status.
- [x] The client is transport only: it holds no permission logic, and the API
      remains the authorization and validation authority for every call.
- [x] The presentation states (loading, empty, error, success,
      permission-denied) and the semantic-token-only styling are implemented in
      B2; the read-only item detail route and the display-only rate order added
      after B2 are recorded in the presentation section above.
- [ ] Live-PostgreSQL and API-server evidence — unexecuted: PostgreSQL
      `127.0.0.1:5433`, Redis `6380` and the API server are unreachable here.
      The proxy, the client and the pages are proven against mocked `fetch`
      only.

## Domain Invariants

- **The proxy is not an authorization authority.** It never derives a tenant,
  never reads a permission and never decides access; it decides only whether a
  request is on the allowlist and whether there is a credential to forward.
- **The tenant comes from the server-side session cookie.** The browser never
  supplies a tenant id, so a cross-tenant item id stays a byte-equivalent `404`
  from the API.
- **Removal is deactivation.** The client exposes no delete call, mirroring the
  API's `POST /catalog/:id/deactivate` command.
- **The reference price is exact decimal text.** The DTO keeps
  `referencePriceAmount`/`referencePriceCurrency` as strings; nothing in the
  browser sums, rounds or converts them.
- **No implicit active-only filter.** `listCatalogItems()` without `isActive`
  reproduces the API's behavior (active and inactive alike); the active-only
  default is a presentation choice and belongs to B2.

## Decided

- **The status filter is the API's `isActive` key, not a `status` parameter.**
  `catalogItemListQuery` validates `{ kind, isActive }` with `.strict()`, so a
  `status` query would be a `400` upstream. `CatalogItemFilters` therefore
  exposes `isActive?: boolean` and serializes it as `isActive=true|false`; the
  UI's "status" intent maps onto the one key the contract defines.
- **A known path with a disallowed method is `405`, not `404`.** The portal
  proxy is the sibling that separates "unknown path" from "known path, wrong
  method" with a uniform method refusal, and it sets no `Allow` header so the
  caller cannot enumerate methods. The older scheduling proxy collapses both
  into `404`; that conflation is deliberately not copied, because this Story
  pins the two cases as different assertions.
- **A missing staff session is refused locally with `401 UNAUTHENTICATED`.**
  There is no credential to forward, so spending an upstream call would only
  reproduce the same envelope one hop later. The message and code are the API's
  own (`auth.guard` + `global-exception.filter`), so the caller sees no
  difference. This is the one deliberate divergence from the scheduling/portal
  proxies, which forward a cookie-less request; a portal cookie can never
  satisfy it, and the portal cookie is never read here.
- **Only the list read accepts a query.** `kind` and `isActive` are rebuilt from
  the allowlist in canonical order, so a duplicate key collapses to its first
  value and a value is always percent-encoded. Any query on another shape, or an
  unknown key on the list, is refused with the uniform not-found envelope rather
  than dropped silently (the portal proxy's query policy).
- **Malformed paths are `400`, unknown paths are `404`.** A `%` escape, an empty
  segment (including a trailing slash or `//`) and a `.`/`..` segment are
  structural defects, so the matched shape is always the requested path; an
  unmatched shape is a genuine unknown route.
- **The client keeps the `patients-api` idiom, including its plain `/${id}` path
  building.** No UUID pre-validation and no path encoding are added on the
  client, exactly as `getPatient`/`getGuardian` do it: the proxy is the boundary
  that refuses a malformed id, so the client stays a thin transport.
- **The active-only default is a presentation rule, not a client rule.**
  `listCatalogItems()` still sends no implicit filter when `isActive` is
  omitted, matching the API. `CatalogList` applies the default by asking for
  `isActive: true` while the "Include deactivated items" checkbox is unchecked,
  and drops the key entirely when it is checked. The API contract is unchanged.
- **The tax-rate selector is required and populated from the GLOBAL list.**
  `CatalogForm` reads `GET /catalog/tax-rates` and cannot submit while the
  selection is empty, because the API has no rate-less item state. The form
  never invents a rate and never mutates the list.
- **A read-only detail route sits between the list and the edit form.** B2 left
  the item name and `Edit` pointing at the same form, so a `catalog.read`-only
  role was dropped into a page it could not submit. The name now opens
  `/app/catalog/:id` (`CatalogItemDetail`), which displays identity, kind,
  selected rate, the optional reference price with its currency and the
  active/inactive status from the same `GET /catalog/:id` read the edit page
  already used. `Edit` stays a separate link, and it is deliberately NOT hidden
  by a client-side permission guess: the client is not the authority, and the
  honest behavior is that the API refuses the write.
- **The rate list is re-ordered for display only.** `GET /catalog/tax-rates`
  orders by `code`, which is deterministic but not presentation-ordered. The UI
  applies `sortTaxRatesForDisplay` (`EXEMPT`, `IVA_5`, `IVA_10`) where it
  renders the selector in `catalog-form.tsx`; the API contract, the seed and the
  stored data keep their own order, and no `position` column is implied. A code
  outside the seeded set sorts after the known ones, so an unexpected rate stays
  visible rather than being dropped.
- **The amount/currency pair is enforced client-side only as convenience.** PYG
  is the offered default and the selector exposes only the `PYG`/`USD` the API
  accepts. The client mirrors the `Decimal(14, 2)` pattern and sends both keys
  together or neither; the API remains the authority and its `400` is surfaced
  truthfully.
- **Deactivation is a deliberate command, never a status edit.** The list
  presents a "Deactivate" button behind a `window.confirm`, calls only
  `POST /catalog/:id/deactivate`, disables it for an already inactive item and
  offers no hard delete and no `isActive` update path.

## API

### Added (web transport only)

```text
GET  /api/catalog                    catalog.read        the item list
GET  /api/catalog/:id                catalog.read        one item
GET  /api/catalog/tax-rates          catalog.read        the GLOBAL rate list
POST /api/catalog                    catalog.create      create (201 upstream)
PUT  /api/catalog/:id                catalog.update      partial update
POST /api/catalog/:id/deactivate     catalog.deactivate  idempotent soft removal
```

### Changed

```text
None. `apps/api/src/catalog/**`, the permission matrix, the schema, the
migration and the seed are untouched by this slice.
```

## Database

No schema, migration or seed change. The proxy and the client touch no database
directly; every read and write reaches `catalog_item`/`tax_rate` through the WU2
API boundary.

## Tests Added

- `apps/web/src/app/api/catalog/[[...path]]/route.test.ts` — 13 cases: the six
  served pairs forwarded with the staff cookie (a table over the whole
  allowlist), the list filters in allowlist order, an unknown query key and a
  query off the list read, four method refusals on known paths, four unknown or
  extra paths, five malformed paths, the portal-cookie-only request, the
  cookie-less request, both cookies present (only the staff cookie crosses), the
  header allowlist, the unbuffered PUT stream, the streamed upstream response
  with `x-request-id`, and the preserved `400`/`403` envelopes.
- `apps/web/src/app/(app)/app/catalog/catalog-api.test.ts` — 11 cases: the four
  read functions, both filter shapes, create, update, deactivate, the `404`
  error normalization, the missing-envelope fallback and the UX-copy mapping.
- `apps/web/src/app/(app)/app/catalog/catalog-list.test.tsx` — 9 cases with a
  mocked `fetch`: the `403 FORBIDDEN` permission-denied state, the
  `403 FEATURE_NOT_ENTITLED` entitlement copy (no invented cause), the `401`
  message, the active-only empty state, the active-by-default request plus the
  include-deactivated toggle, the kind filter combined with the default status,
  the explicit `POST /catalog/:id/deactivate` after confirmation, the disabled
  deactivate for an already inactive item, and the name link to the detail route
  beside the `Edit` link to the edit route.
- `apps/web/src/app/(app)/app/catalog/catalog-form.test.tsx` — 9 cases: the PYG
  default and the `PYG`/`USD`-only currency list, the rate selector in human
  order despite the API's lexicographic `code` order, a create with the required
  rate and the price pair, a create that omits the pair, the refusal to submit
  without a rate, the client-side amount rejection, the truthful `400` and `403`
  surfacing, and the edit that sends only changed fields and clears the pair as
  a pair.
- `apps/web/src/app/(app)/app/catalog/[id]/catalog-item-detail.test.tsx` — 7
  cases with a mocked `fetch`: the read-only rendering (identity, kind, rate,
  price with currency, status) with `Edit` pointing at the edit route and no
  deactivate command, the inactive item with no price shown as `Not set`, the
  `403 FORBIDDEN` permission-denied state, the `403 FEATURE_NOT_ENTITLED`
  entitlement copy, the mapped `404` copy, the `401` message, and the explicit
  loading state.
- `apps/web/src/components/shell/nav-sidebar.test.tsx` — reconciled to the real
  `/app/catalog` entry: 4 link destinations plus the 3 placeholder sections.

## Verification

```text
pnpm --filter @newsaas/web test ............ 48 files passed; 489 tests passed
                                             (1 file / 9 cases added: the
                                             read-only detail suite, the list
                                             link case and the rate-order
                                             case. The rest of the growth over
                                             the B2 record is other in-flight
                                             uncommitted slices)
pnpm --filter @newsaas/web typecheck ....... clean
pnpm --filter @newsaas/web lint ............ clean
pnpm exec prettier --check <touched files> . All matched files use Prettier
                                             code style
git diff --check ........................... clean
```

Focused pre-run (read-only detail + rate order):
`pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts "src/app/(app)/app/catalog/catalog-list.test.tsx" "src/app/(app)/app/catalog/catalog-form.test.tsx" "src/app/(app)/app/catalog/[id]/catalog-item-detail.test.tsx"`
reported 3 files / 25 tests passed.

Unexecuted here: anything needing the API server, PostgreSQL (`127.0.0.1:5433`)
or Redis (`6380`). The web production build is B3's and was not re-executed in
this reconciliation (no API server, database or build run was needed for these
two gaps).

## Known Limitations

- The proxy and the client are proven against mocked `fetch` only. No request
  was ever forwarded to a running API, so the allowlist is verified as a
  contract, not as observed end-to-end traffic.
- The proxy refuses a cookie-less request locally while the scheduling and
  portal proxies forward it. The envelope is identical, but the two hops differ
  and a future proxy should pick one rule deliberately.
- The client's list does not default to active items by itself: an omitted
  `isActive` returns active and inactive alike, matching the API. The
  active-only default now lives in `CatalogList`, where it is a presentation
  choice with a visible toggle; the client module is unchanged.
- `403` bodies are relayed verbatim, so a caller sees the API's wording. The
  proxy adds no catalog-specific copy of its own; `userFacingCatalogError` is
  the only place that maps codes to UX text.
- The read-only detail gap recorded here after B2 is closed. The item name now
  opens `/app/catalog/:id` as a read-only page and `Edit` stays a separate link,
  so a `catalog.read`-only role is no longer dropped into a form it cannot
  submit. The detail page offers no mutation and no deactivate command.
- No browser flow has been exercised against a running API or database; the
  component coverage mocks `fetch` and never leaves the process.
- The `~400` authored-line review heuristic is exceeded by the B2 pages, the
  three component suites and the Story update together; the states, the
  validation convenience and the honest error surfacing were kept intact rather
  than split into artificial files.
- The human rate order is a web presentation rule (`tax-rate-order.ts`): the API
  still returns the lexicographic `code` order, so any other consumer must apply
  its own display order. Closing that properly would need a display-order
  decision on the API side, which this change did not make.

## Next Step

WU3 B3 runs the focused and root checks over the whole unit and reports every
executed command with its observed result, including the web build. The
`SERVICE`↔`Appointment` association and agenda filter (WU4) and the
live-PostgreSQL closure evidence (WU5) remain open for the epic.

## Files / Modules

- `apps/web/src/app/api/catalog/[[...path]]/route.ts` — the allowlisted
  authenticated proxy, its shape classification and its rejection envelopes.
- `apps/web/src/app/api/catalog/[[...path]]/route.test.ts` — the boundary tests.
- `apps/web/src/app/(app)/app/catalog/catalog-api.ts` — the client DTOs, the six
  calls and the error mapping.
- `apps/web/src/app/(app)/app/catalog/catalog-api.test.ts` — the transport
  contract of that module.
- `apps/web/src/app/(app)/app/catalog/page.tsx` — the server page wrapping the
  client catalog list.
- `apps/web/src/app/(app)/app/catalog/catalog-list.tsx` — the list, the kind and
  status filters, the states and the explicit deactivate command. The item name
  links to the read-only detail route.
- `apps/web/src/app/(app)/app/catalog/catalog-list.test.tsx` — its component
  coverage with a mocked `fetch`.
- `apps/web/src/app/(app)/app/catalog/catalog-form.tsx` — the shared create/edit
  form with the required rate selector and the optional price pair. The selector
  renders in human order even though the API orders rates by `code`.
- `apps/web/src/app/(app)/app/catalog/catalog-form.test.tsx` — its component
  coverage.
- `apps/web/src/app/(app)/app/catalog/new/page.tsx` and
  `apps/web/src/app/(app)/app/catalog/[id]/edit/page.tsx` — the create and edit
  reach-through pages.
- `apps/web/src/app/(app)/app/catalog/[id]/page.tsx` and
  `apps/web/src/app/(app)/app/catalog/[id]/catalog-item-detail.tsx` — the
  read-only detail page and its identity, kind, rate, price and status shell.
- `apps/web/src/app/(app)/app/catalog/[id]/catalog-item-detail.test.tsx` — its
  component coverage with a mocked `fetch`.
- `apps/web/src/app/(app)/app/catalog/tax-rate-order.ts` — the display-only
  `EXEMPT`, `IVA_5`, `IVA_10` ordering applied to the fetched rate list.
- `apps/web/src/components/shell/nav-sidebar.tsx` and its test — the real
  `/app/catalog` staff destination.
- `docs/01-roadmap/EPIC-09-Catalog-Taxes.md` — the Stories entry for `CAT-004`.
