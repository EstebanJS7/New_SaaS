# EPIC-09 WU3 — Staff catalog UI and web proxy

## Objective

Give staff a real catalog surface: an allowlisted authenticated web proxy for
the catalog routes, and pages to list, create, edit and deactivate items, with
the required loading, empty, error, success and permission-denied states built
from semantic design tokens.

## Problem and why

The API shipped in WU2, but no browser can reach it: there is no `/api/catalog`
proxy, no page under `/app/catalog`, and the sidebar has no catalog destination.
Until this exists, the catalog is an API nobody can use, and `customers`,
`patients` and `agenda` remain the only real staff destinations.

## Scope and constraints

- In scope: the proxy route with a strict path/query/method allowlist that
  forwards only the staff session cookie, the client API module, the item list
  with kind and status filters, the create/edit form with the required
  seeded-rate selection and the optional price pair, the deactivate command, the
  sidebar entry, and component plus proxy tests.
- Carried product decisions: the list defaults to ACTIVE items with a visible
  toggle to include deactivated ones, because an unfiltered list mixes retired
  items into daily work; the form offers PYG by default and only the currencies
  the API accepts (`PYG`, `USD`); the rate selector is populated from the global
  rate list and cannot be left empty.
- States required by the engineering rules: loading, empty, error, success and
  permission-denied, using semantic design tokens and never a brand literal or
  arbitrary tenant styling.
- Out of scope: the `SERVICE`↔`Appointment` association and agenda filter (epic
  WU4); live-PostgreSQL evidence and closure (epic WU5); editing tax rates (they
  are global and read-only); stock, POS, invoice, fiscal and any tax or price
  arithmetic; widening the accepted currency list.
- Preserve unrelated uncommitted work; do not push; commit only when the
  maintainer asks.
- TDD mode: disabled, source `openspec/config.yaml` `strict_tdd: false`; runner
  `pnpm test` (`pnpm --filter @newsaas/web test`).

## Tasks

- [x] B1: Transport: the `/api/catalog` proxy with its strict allowlist and
      cookie forwarding, the catalog client API module, the Story for this unit,
      and their tests.
- [x] B2: Presentation: the catalog list with filters and states, the
      create/edit form with rate and price handling, the deactivate command, the
      real sidebar entry, and component tests.
- [x] B3: Run focused and root checks over the unit and report every executed
      command with its observed result and anything that could not run.

## Acceptance criteria and checks

- The proxy forwards only allowlisted paths and shapes, only the staff session
  cookie, and returns the same uniform rejection for anything else; it never
  forwards the portal cookie or an arbitrary path.
- A staff user with `catalog.read` sees the list; a user without it gets a
  permission-denied state and no data, and the client is never the authority.
- The list supports the kind and status filters, defaults to active, and has
  explicit loading, empty and error states.
- Create and edit require a selected seeded rate, offer PYG by default, enforce
  the amount/currency pair client-side as convenience while the server stays the
  authority, and surface a `400` or `403` honestly rather than inventing a
  cause.
- Deactivation is reachable only as the explicit command the API exposes, and
  the UI never presents a hard delete.
- All styling uses semantic design tokens; no brand literal is introduced in a
  reusable component.
- `pnpm --filter @newsaas/web test`, `pnpm --filter @newsaas/web typecheck`,
  `pnpm --filter @newsaas/web build` and root lint, typecheck, test, build and
  format-check are reported with exact commands and results.
- Anything requiring a live database or the API server is reported as
  unexecuted, not assumed.

## Progress

- Planning: WU1 and WU2 are complete; the API surface, permissions and audit are
  live and green. No web file written yet for this unit.
- Verification: pending.
- B1: the `/api/catalog` proxy and the `catalog-api.ts` client module are in
  place with 13 proxy cases and 11 client cases, plus the CAT-004 Story recorded
  in the epic. The proxy classifies the path shape independently of the method,
  allows exactly the six served pairs, rebuilds the query for `GET /catalog`
  from `kind`/`isActive` only, refuses unknown query keys rather than dropping
  them, and reads only the named staff session cookie — a portal-only request
  never reaches the API.
- Two deliberate divergences from the older sibling proxies, both documented in
  the Story: a known path with a disallowed method answers `405` (the newer
  portal-proxy precedent) instead of the older `404`, and a request with no
  staff session is refused locally with the API's own `401` envelope before any
  upstream call. The repo is not uniform here: a consistency candidate for Tech
  Debt rather than something to hide.
- Verification: green. Web suite 45 files / 452 tests (was 43/428), focused run
  24/24, web `typecheck` and `lint` clean, targeted Prettier and
  `git diff --check` clean. Web `build` belongs to B3 and has not run yet;
  nothing needs a live API server, and no request was ever forwarded for real.
- B2: `/app/catalog` is live with the kind filter, an active-by-default status
  filter and a visible control to include deactivated items, plus loading,
  empty, error and permission-denied states; the shared form covers create and
  edit with a required rate selector, a PYG-defaulted amount/currency pair and
  honest `400`/`403` surfacing; deactivation is an explicit confirmed command
  with no delete and no generic status edit; and the sidebar gained the real
  `Catalog` entry with its test reconciled. Eight list cases and eight form
  cases were added.
- B3: Root gates green — `pnpm lint` (14 tasks), `pnpm typecheck` (14 tasks),
  `pnpm test` exit 0 (preflight 2/6, ui 6/36, worker 6/37, api 69 passed + 1
  skipped / 823 passed + 40 skipped, database 13/204, web 47/468), `pnpm build`
  (9 tasks, including the web build), `pnpm format-check`, and both
  `git diff --check` variants.
- Verification: WU3 complete for every check this environment can run. Still
  unexecuted because no API server, PostgreSQL or Redis is reachable: no page
  has ever talked to the real API, the proxy has only met mocked fetch, and
  Playwright stays deferred (`TD-007`).
- Known gap carried to the maintainer, recorded in CAT-004: there is no
  read-only detail page, so an item name or Edit button leads a `catalog.read`
  user to a form they cannot submit. Closing it is a small, deliberate addition
  rather than a silent scope expansion.
- Next: epic WU4 (appointment service linkage and agenda filter), then WU5
  (live-PostgreSQL closure evidence and documentation).

## Verification evidence

- Pending for this unit. Earlier units' evidence lives in
  `odd/tasks/epic-09-wu1-catalog-foundation.md` and
  `odd/tasks/epic-09-wu2-catalog-api.md`.

## Notes

- The web package runs its Vitest files sequentially and pins the RTL wait
  window, so new component tests inherit that configuration.
- Playwright E2E remains deferred (`TD-007`), so page coverage is
  component-level with a mocked fetch.
