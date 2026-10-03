# Changelog

All notable product changes will be documented here.

## Unreleased

### Added

- EPIC-15 — Fiscal Abstraction (FISC-003 to FISC-005, completing the epic):
  - The reusable Core Fiscal boundary: a provider port with a normalized outcome
    taxonomy (`APPROVED`, `REJECTED`, `FUNCTIONAL_REJECTION`,
    `CONFIGURATION_ERROR`, `TRANSIENT_FAILURE`), a deterministic
    `FakeFiscalProvider` with ordered scripts and no invented SIFEN artifact, a
    fail-closed snapshot sanitizer that redacts rather than throws, and a
    composition root that refuses to select a fake in production.
  - Queued fiscal submission: `POST /fiscal-documents` commits the document as
    `QUEUED` and enqueues one BullMQ job with the deterministic identity
    `fiscal-submit:<documentId>` after the commit, with a 2 s enqueue deadline
    and fail-fast Redis options so a Redis outage cannot hang an HTTP request.
  - The worker handler claims the document with a compare-and-set into
    `SENDING`, calls the provider outside any transaction, sanitizes both raw
    payloads before persisting, writes one SYSTEM audit row per attempt and
    rethrows on a transient failure so the bounded backoff owns the retry. A
    five-minute claim lease recovers a worker that dies between the claim and
    the call.
  - The recovery sweep `recoverStaleFiscalSubmissions` plus
    `redriveFiscalSubmission`: it re-drives `QUEUED` and `ERROR` documents older
    than a five-minute window in batches of 100, removing a terminal job before
    re-adding it because a deterministic job ID plus `removeOnFail: false` would
    otherwise make the re-add a silent no-op.
  - The status transition guard, extended additively by the cancellation edges.
    `SENDING -> CANCELLED` stays excluded because a worker holds that claim, and
    `resolved_at` is an implication rather than a biconditional, which is what
    keeps `APPROVED -> CANCEL_PENDING -> CANCELLED` legal while the resolution
    timestamp survives.
  - `POST /fiscal-documents/:id/cancel`: a synchronous, deadline-bounded command
    behind the existing `fiscal.invoice.issue`. `CANCELLED` replays as `200`, a
    `SENDING` document is a stable `409`, and a refusal is thrown after the
    outcome write commits so `last_error_*` and the audit row persist.
  - The [[DEC-051]] hand-off: Billing consults a Fiscal read inside its own
    cancellation transaction, so any live fiscal document blocks the invoice
    cancellation with a `409` naming the Fiscal cancellation route. The
    dependency stays one-way and Billing never imports the Fiscal package.
  - The fiscal read contract: a read-wide `fiscal.read` key for all six roles,
    `GET /fiscal-documents` with a strict optional status filter, and
    `GET /fiscal-documents/:id`. Reads are unaudited and the seeded catalog
    moves 56 → 57 permissions and 187 → 193 role grants.
  - The `/app/fiscal` staff workspace: the document list, the detail with the
    cancel form, and the issue panel, through the `/api/fiscal` proxy, covering
    loading, empty, error, success, permission-denied and entitlement-denied
    states, with a declarative `requiredFeature: "fiscal"` navigation entry.
  - Deliberately NOT in this epic: no real SIFEN or third-party provider, no
    XAdES signing or KuDE rendering (PRD §23, [[EPIC-16]]), no
    operator-triggered retry route ([[TD-029]]), no `fiscal-ui` settings
    namespace ([[DEC-052]]), and no portal fiscal document surface ([[TD-022]]).

- EPIC-15 — Fiscal Abstraction (FISC-002, data foundation only):
  - The additive `FiscalDocument` persistence foundation the Fiscal boundary
    rests on: `enum FiscalProvider` with PRD §22's `THIRD_PARTY`, `SIFEN_DIRECT`
    and `FAKE`, and `enum FiscalDocumentStatus` with the SIFEN lifecycle minus
    `SIGNING` — the XAdES signing stage PRD §23 defers to a real adapter.
  - A tenant-scoped `fiscal_document` with the `(tenant_id, id)` ownership key,
    a composite RESTRICT foreign key to `invoice`, provider/external-id/CDC
    fields, private XML/KuDE storage references, sanitized request/response
    snapshots and attempt/error counters. It duplicates no invoice series,
    number, currency, customer or money: a confirmed invoice is immutable, so
    the provider request is read through the composite ownership key.
  - Two named CHECKs (`attempt_count >= 0` and the cancellation biconditional
    `(cancelled_at IS NULL) = (status <> 'CANCELLED')`) and five structural
    triggers: no delete, cancelled immutable, identity immutable, provider
    references write-once and attempts monotonic.
  - One non-cancelled fiscal document per invoice, enforced by the partial
    unique index `(tenant_id, invoice_id) WHERE status <> 'CANCELLED'`, mirrored
    from the invoice-per-sale index so re-issuing requires an explicit
    cancellation rather than a silent second document.
  - Deliberately NOT in this slice: no API, route, worker, provider, settings
    namespace or seed change. The status transition allow-list belongs to
    FISC-004, so an `APPROVED` or `REJECTED` document is still updatable at the
    database level until then. Fiscal state stays off `Invoice` by decision
    ([[DEC-042]], [[DEC-046]]).

- EPIC-14 — Billing:
  - The invoice aggregate PRD §21 requires: a tenant-scoped `invoice` with the
    `DRAFT`/`CONFIRMED`/`CANCELLED` lifecycle, an immutable `invoice_line`
    snapshot copied verbatim from the frozen sale lines, and a per-tenant
    `invoice_number_sequence`. One **live** invoice per sale is a PARTIAL unique
    index, so a cancelled invoice releases its sale for a corrected replacement.
  - `POST /invoices`: creates a `DRAFT` invoice from exactly one completed sale,
    copying the sale's frozen snapshot verbatim, describing each line with the
    catalog item's name, and refusing rather than truncating a name over 200
    characters. The invoice stores no header totals: the API projects them from
    its own immutable lines, so Billing never computes money.
  - `GET /invoices` (with a status filter) and `GET /invoices/:id`, both
    tenant-scoped, so a foreign or unknown identifier is a byte-equivalent
    `404`.
  - `POST /invoices/:id/confirm`: locks the invoice, gates on `DRAFT`, allocates
    the number with ONE atomic statement that also creates the tenant's counter
    row, and co-commits one audit row. A retried confirmation replays the same
    number without advancing the counter.
  - `POST /invoices/:id/cancel`: cancels a `DRAFT` or `CONFIRMED` invoice with a
    required reason, keeping the allocated number and the original confirmation
    timestamp. `CANCELLED` is terminal, and no payment, cash, stock or fiscal
    record is touched.
  - A tightened header guard: a permitted transition can no longer rewrite the
    invoice's tenant, identity, sale, customer, currency, series or creation
    timestamp, so a cancellation cannot silently re-point a document.
  - The staff Billing workspace at `/app/billing` — the invoice list with its
    status filter, the detail with the snapshot lines and the API's projected
    totals, create-from-a-completed-sale, confirm and cancel with a reason, the
    full loading/empty/error/success/permission-denied/entitlement-denied state
    coverage, and a capability-gated navigation entry — over an `/api/billing`
    proxy that allowlists exactly the five routes and forwards staff cookie
    context only.
  - Deliberately NOT in this epic: fiscal documents, providers and submission
    (EPIC-15/EPIC-16), the portal invoice surface (deferred), printed or
    exported documents, reports, notification delivery, standalone invoicing
    without a completed sale, and sale reversal or payment refund ([[TD-018]]).

- EPIC-13 — Cash:
  - The remaining PRD §20 cash movement kinds (`REFUND`, `INCOME`, `EXPENSE`,
    `WITHDRAWAL`, `DEPOSIT`, `ADJUSTMENT`) appended to the existing `SALE`
    value, with the sign owned by the kind and an explicit `INCREASE`/`DECREASE`
    direction required exactly for `ADJUSTMENT`.
  - `POST /cash/movements`: a standalone non-sale movement against an `OPEN`
    session, with a reason required for every kind but `INCOME`, the session
    resolved in-tenant and the register derived server-side. It is idempotent
    through a required `Idempotency-Key`, so an identical retry replays the
    stored movement instead of double-counting cash.
  - `GET /cash/movements`, the tenant-scoped movement list of one session or of
    the whole tenant.
  - `POST /cash/sessions/:id/close`: it locks the session, computes the expected
    amount on the server from the opening amount and the movements, stores the
    expected, counted and difference amounts, compares them with the operator's
    count, writes one audit row and leaves the session terminally `CLOSED`. A
    shift with no movement closes with the opening amount as its expectation,
    and a second close is a stable conflict.
  - The staff Cash workspace at `/app/cash`: registers, sessions with their
    filter and open form, the movement ledger with its create form, and the
    close with the expected/counted comparison — over an `/api/cash` proxy that
    grew to seven routes and a Cash client that now lives with its own domain
    instead of under the sales route.
  - One new permission key (`cash.movement.create`) granted to `OWNER`, `ADMIN`
    and `CASHIER`, moving the seeded catalog from 51 to 52;
    `cash.session.close`, seeded since EPIC-01, is finally consumed by the close
    route.
- EPIC-12 — POS and payments:
  - The `Sale` aggregate with a `sale_status` enum pinned to `DRAFT`,
    `COMPLETED` and `CANCELLED`, priced lines that freeze their tax-included
    snapshot (`rate_code`, `unit_price`, `quantity`, `line_total`,
    `taxable_base`, `tax_amount`) and a fixed-scale money discipline with no
    stored total column.
  - The draft lifecycle with an explicit cancel, and the atomic idempotent
    `CompleteSale` command: it validates the totals, the payments and the stock,
    writes signed negative `SALE` movements through the inventory ledger under
    its `(tenant, item)` serialization protocol, writes one `SALE` cash movement
    per CASH payment, records the PRD §19 payments, marks the sale `COMPLETED`
    and audits — or persists nothing. An identical replay returns the prior
    result (`200`) instead of a conflict.
  - The minimal Cash foundation the sale needs: tenant-scoped registers,
    sessions with a required opening amount and immutable movements, with the
    one-`OPEN`-session-per-register rule enforced by a database partial unique
    index.
  - The staff POS surface: proxies that forward only the staff session cookie, a
    counter with a local cart, reference-price pre-fill with an operator
    override, an optional customer, a payment capture across the six methods
    with an exact-sum guard, and the draft detail and completion flows.
  - Five new permission keys (`sales.read`, `sales.create`, `sales.update`,
    `sales.cancel`, `sales.complete`) plus three for cash (`cash.read`,
    `cash.register.create`, `cash.session.open`), moving the seeded catalog from
    43 to 51, with the sales and cash surfaces gated on their own capabilities.
- EPIC-09 — Catalog and taxes:
  - Tenant-scoped `CatalogItem` aggregate over `PRODUCT`, `SERVICE`,
    `MEDICATION` and `SUPPLY`, with deactivation as the only removal (a
    `BEFORE DELETE` trigger rejects hard deletes) and an optional informational
    reference price as an amount plus ISO 4217 currency pair (`Decimal(14, 2)`,
    PYG default).
  - Global, platform-seeded and tenant read-only tax-rate list (`EXEMPT 0%`,
    `IVA_5 5%`, `IVA_10 10%`) that every item must reference through a non-null
    `Restrict` foreign key; no tenant-created rates, no rate mutation route and
    no per-item override. The seed must run before any item can be inserted.
  - `catalog.read` / `catalog.create` / `catalog.update` / `catalog.deactivate`
    with the decided role matrix, six allowlisted INTERNAL routes (rate list,
    list, detail, create, update, deactivate), Zod validation, transactional
    `catalog_item.*` audit rows and byte-equivalent cross-tenant `404`.
  - Staff catalog surface at `/app/catalog` (kind/status filters, read-only
    detail, create/edit with a required rate selector, explicit deactivate)
    behind an allowlisted `/api/catalog` proxy that forwards only the staff
    session cookie.
  - An OPTIONAL `SERVICE` catalog reference on `Appointment` and the PRD §14
    agenda service filter, preserving the caller-supplied `durationMinutes` and
    adding no portal service selection.
  - Two additive migrations, seed idempotency coverage, and local
    live-PostgreSQL evidence for the catalog aggregate (47/47, including its
    isolation, audit-co-commit and concurrent-deactivation cases).
  - `EPIC-09`, `CAT-001`–`CAT-005`, the `Catalog-Taxes` module documentation,
    and the `TD-013`/`TD-014`/`TD-015` debt records.

  The epic is `review`, not `done`: every gate this environment can run is green
  and the live-PostgreSQL evidence exists locally, but the work units are not
  committed, pushed or merged, so the merged-work-units exit criterion is still
  open. `review` means implementation closure pending delivery — it is **not** a
  production-readiness statement. [[EPIC-20]] Production Hardening and the open
  Tech Debt items remain.

- EPIC-10 — Inventory:
  - Tenant-scoped, immutable `StockMovement` ledger (PRD §16): signed
    `Decimal(10, 3)` quantity with `CHECK (quantity <> 0)`, a mandatory reason,
    movements created confirmed, a `BEFORE DELETE` trigger rejecting hard
    deletes and reserved compensating `reversesMovementId` self-reference. The
    movement-type enum ships `ADJUSTMENT` only; purchases, sales, transfers and
    reversals arrive with [[EPIC-11]]/[[EPIC-12]].
  - `StockBalance` transactional projection, exactly one row per (tenant, item)
    with `CHECK (quantity >= 0)`, updated in the same transaction as its
    movements.
  - `CatalogItem.tracksStock` (`tracks_stock`) with a database default and a
    by-kind backfill, consumed as the inventory write-path gate: a movement
    against a non-tracking or inactive item is a `409 CONFLICT` and persists
    nothing.
  - `POST /inventory/stock/adjustments` (signed adjustment; movement, balance
    and exactly ONE audit row co-committed in one transaction under the fixed
    `BLOCK` negative-stock policy), plus `GET /inventory/stock` and
    `GET /inventory/stock/movements` with allowlisted INTERNAL projections and a
    byte-equivalent cross-tenant `404`.
  - `inventory.stock.adjust` / `inventory.stock.read` with the decided role
    matrix (OWNER/ADMIN/INVENTORY_MANAGER hold both; the other three roles
    read).
  - Transaction-scoped per-`(tenant, item)` advisory-lock serialization
    (`pg_advisory_xact_lock` on `stockSerializationLockKey`): every future stock
    writer MUST acquire the same key before touching `stock_balance`.
  - One additive migration, `20260925000003_inventory`, and local
    live-PostgreSQL evidence at 52/52 for the ledger — including a REAL lost
    update (two concurrent outputs both committed, projection `3.000` against a
    ledger sum of `-4.000`) that the keyed lock found and fixed.
  - `EPIC-10`, `CAT-006`, `CAT-007`, the `Inventory` module documentation and
    the `TD-016` serialization-protocol debt record.

  The epic is `review`, not `done`: every gate this environment can run is green
  and the live-PostgreSQL evidence exists locally, but the work is not
  committed, pushed or merged, so the merged-work-units exit criterion is still
  open. `review` means implementation closure pending delivery — it is **not** a
  production-readiness statement. [[EPIC-20]] Production Hardening and the open
  Tech Debt items remain.

- EPIC-11 — Suppliers (SUP-001 supplier foundation):
  - Tenant-scoped supplier registry (PRD §5) with a `RESTRICT` tenant foreign
    key, the composite ownership unique key `(tenant_id, id)`, a name lookup
    index, a 1..200 name CHECK and a `BEFORE DELETE` trigger rejecting hard
    deletes — removal is deactivation, so historical references survive.
  - Per-tenant `taxId` uniqueness **when present** through the partial unique
    index `supplier_tenant_id_tax_id_key` on
    `(tenant_id, tax_id) WHERE tax_id IS NOT NULL`, declared as raw SQL because
    Prisma cannot express partial indexes; any number of absent identifiers
    coexist and the same value in another tenant is a different key.
  - One additive migration, `20260926000001_suppliers`, creating the `supplier`
    table without altering any existing table or inserting rows.
  - `suppliers.read` / `suppliers.create` / `suppliers.update` /
    `suppliers.deactivate` with the decided role matrix (all six roles read;
    OWNER, ADMIN and INVENTORY_MANAGER write) and no entitlement gate —
    suppliers are a Core capability. The seed count moves 34 → 38; the five
    `purchases.*` keys arrive with PUR-001/PUR-002.
  - Five unprefixed allowlisted INTERNAL routes — `GET /suppliers`,
    `GET /suppliers/:id`, `POST /suppliers`, `PUT /suppliers/:id` (partial
    update with absent-versus-null semantics) and
    `POST /suppliers/:id/deactivate` (idempotent) — plus a shared
    byte-equivalent cross-tenant `404` and a stable value-free `409 CONFLICT`
    for a duplicate present `taxId`.
  - One co-committed `supplier.created` / `supplier.updated` /
    `supplier.deactivated` audit row per accepted mutation, carrying field
    **names** only; reads are never audited.
  - `SUP-001`, the `Suppliers` module documentation and the module index entry.
  - Tenant-scoped purchase draft aggregate (PRD §17) — `Purchase` with a
    `DRAFT`/`RECEIVED`/`CANCELLED` `purchase_status` enum and `PurchaseLine`
    children, both carrying composite `(tenant_id, id)` ownership keys and
    `RESTRICT` tenant/supplier/purchase/catalog-item foreign keys, plus the
    `purchase_line_quantity_positive` and `purchase_line_unit_cost_non_negative`
    CHECKs, the tenant-leading duplicate-line unique
    `(tenant_id, purchase_id, catalog_item_id)` and the
    `purchase_tenant_id_status_idx` list lookup. There is no number, total, tax
    or valuation column ([[DEC-018]], [[DEC-013]]).
  - One additive migration, `20260926000002_purchases`, creating the enum and
    the two tables without altering any existing table or inserting rows.
  - Conditional immutability ([[DEC-019]]): a `BEFORE DELETE` trigger on each of
    `purchase` and `purchase_line` raises `restrict_violation` only while the
    owning purchase is `RECEIVED` or `CANCELLED`, so a `DRAFT` stays fully
    editable — including dropping a line entered by mistake — while a confirmed
    or cancelled purchase and its lines stay immutable and readable.
  - `purchases.read` / `purchases.create` / `purchases.update` /
    `purchases.cancel` with the decided role matrix (all six roles read; OWNER,
    ADMIN and INVENTORY_MANAGER write) and no entitlement gate. The seed count
    moves 38 → 42; `purchases.receive` arrives with PUR-002 to reach 43.
  - Five unprefixed allowlisted INTERNAL routes — `GET /purchases`,
    `GET /purchases/:id`, `POST /purchases`, `PUT /purchases/:id` and
    `POST /purchases/:id/cancel` — with the submitted line set reconciled by
    `catalogItemId` on update (retain, update in place, insert, remove), a
    byte-equivalent cross-tenant `404`, and a stable `409 CONFLICT` for an edit
    or cancel of a non-`DRAFT` purchase. There is no `PATCH` and no `DELETE`.
  - One co-committed `purchase.created` / `purchase.updated` /
    `purchase.cancelled` audit row per accepted mutation, carrying field
    **names** only; reads are never audited. The draft path is inert: it writes
    no stock movement, no balance, no cash, invoice, payment or fiscal state and
    allocates no number — receiving belongs to PUR-002.
  - `PUR-001`, the `Purchases` module documentation, the module index entry and
    durable live-PostgreSQL coverage: the live suite now runs 65/65, including a
    7-case purchase-draft boundary block (the ledger-inert draft create, the
    duplicate-line unique, [[DEC-019]]'s conditional immutability, the line-set
    reconciliation, the DRAFT-only `409`, the composite foreign keys and the
    quantity/cost CHECKs).
  - Explicit purchase receiving (PUR-002) — `POST /purchases/:id/receive` behind
    the new `purchases.receive` key, the purchase lifecycle's only stock effect.
    It row-locks the purchase HEADER first and re-reads the status after the
    lock, resolves and gates every line in-tenant (ACTIVE and `tracksStock`,
    reusing the inventory `409` messages), acquires the per-`(tenant, item)`
    advisory locks in ascending `catalogItemId` order, writes one positive
    `PURCHASE` movement and one balance projection per line through the EPIC-10
    ledger seam, flips the status and appends exactly one `purchase.received`
    audit row — all in one transaction, or persists nothing. A replay or any
    non-`DRAFT` purchase is a stable `409`, a cross-tenant or unknown id the
    shared `404`, and the body is a strict empty contract.
  - One additive migration, `20260926000003_purchase_receiving`, appending
    `PURCHASE` to `stock_movement_type`; existing `ADJUSTMENT` rows, position
    and behavior are unchanged and no existing migration is rewritten.
  - `purchases.receive` joins the seed with the decided role matrix (all six
    roles read; OWNER, ADMIN and INVENTORY_MANAGER receive), completing the
    [[DEC-016]] total at 43. The route joins the exact route inventory and its
    per-route permission pin.
  - `PUR-002`, the `Purchases` module documentation extended with the receiving
    behaviour, the `Inventory` module documentation updated to read `ADJUSTMENT`
    and `PURCHASE` as implemented while `SALE`, `TRANSFER_*` and `*_REVERSAL`
    stay future, and [[TD-016]] updated with the compliant receiving call site
    (the debt stays open). Live-PostgreSQL coverage grows to 71/71, including a
    6-case receiving block whose concurrent double-receive race admits exactly
    one `201` under a proven header-row-lock overlap.

  - Staff purchases surface (PUR-003) — two authenticated Next.js route handlers
    (`/api/suppliers` and `/api/purchases`) behind a strict
    `(method, path-shape)` allowlist, with cookie-only forwarding, no
    synthesized tenant/role/permission header, a query rebuilt from the one
    allowlisted key, and the uniform `404`/`405`/`400`/`401` rejection contract
    in the API's own `{ error: { code, message } }` envelope.
  - Supplier pages (list with an active-only default, read-only detail and a
    shared create/edit form with absent-versus-null semantics and no `isActive`
    control) and purchase pages (list, read-only detail, a draft create/edit
    form over the full line set, explicit cancel and the confirm-guarded receive
    action), registering `Suppliers` and `Purchases` navigation entries.
  - Loading, empty, error, success and permission-denied states on every page,
    pending/success/error mutation feedback, cache invalidation after each
    accepted mutation, and a receive flow that renders success, the non-draft
    `409`, the inactive-item `409`, the non-tracking-item `409`, `403`, `404`
    and a transport error as distinct outcomes with no silent retry.
  - No API route, schema model, migration, seed entry or permission key changed:
    the surface consumes the contracts [[SUP-001]], [[PUR-001]] and [[PUR-002]]
    already shipped.

  EPIC-11 is **done**, and `done` here means **implementation closure only**:
  all four stories ([[SUP-001]], [[PUR-001]], [[PUR-002]] and [[PUR-003]]) are
  merged into `main` — merge commits `baa66ca`, `f214003`, `8862050` and
  `e12ac1f` through pull requests #68, #70, #71 and #73 — with the required CI
  checks green, and the epic's live-PostgreSQL evidence runs in CI's
  `Database migrations` job on every pull request, so it is machine-verified
  rather than local-only. The delivery receipts are recorded in
  `docs/10-qa/CI-EVIDENCE.md`. This is **never** a production-readiness
  statement and it approves no release or deployment: [[EPIC-20]] Production
  Hardening and the open Tech Debt items remain, [[TD-013]] stays open now that
  its trigger has fired, and [[TD-016]] stays open although the receiving writer
  complies with its protocol.

- EPIC-06 — Clinical records:
  - Six tenant-scoped, Patient-anchored clinical models (encounter + treatments,
    vaccinations, deworming, studies, weights) with a RESTRICT-FK additive
    migration and a DB-enforced CLOSED immutability/no-delete trigger.
  - Version-guarded DRAFT autosave (`409 CONFLICT` on drift), explicit close,
    and linked, audited, idempotent amendments.
  - `vet.clinical.read|create|update|close|amend` permissions plus the
    `veterinary` entitlement gate and allowlisted CONFIDENTIAL DTOs.
  - Clinical HTTP surface and a Patient-detail staff workspace via the
    authenticated `/api/clinical` proxy.
  - Live-PostgreSQL application-path evidence for byte-equivalent cross-tenant
    `404`, negative cross-tenant amendment assertions, and a deterministic
    parallel-autosave race yielding one success + one `409 CONFLICT`.
  - `EPIC-06`, `VET-004`, and `Clinical` module documentation.
- EPIC-03 Phase B — tenant branding overrides and admin surface:
  - `tenant_branding` table with one row per tenant, versioned JSON overrides,
    and additive migration.
  - Private `GET /branding/current`, `PUT /branding/current`,
    `POST /branding/reset` endpoints gated by `branding.settings.manage` and the
    `custom_branding` entitlement, with audit co-commit.
  - Public `GET /api/v1/public/tenants/:slug/branding` allowlisted DTO.
  - Server-side brand resolution in the staff layout and bounded preview UI at
    `/app/settings/branding`.
- EPIC-04 — reusable Customer Core:
  - Tenant-scoped `Customer`, `CustomerAddress`, `CustomerContact`, and inert
    `PatientGuardian` scaffold.
  - Six `customers.*` permissions and role matrix.
  - REST surface for customer CRUD/deactivate and nested address/contact
    management.
  - Staff web UI at `/app/customers` with Next.js API proxy.
- Corrective H1 round for EPIC-04:
  - Customer/Address/Contact lookups now filter by `id` + server-derived
    `tenantId` in the database query itself (`findFirst`); byte-equivalent 404
    behavior preserved.
  - Removed free-text deactivation `reason` from Customer/Address/Contact audit
    metadata; API, spec, and design aligned to ID/schema-version/field-name-only
    audit payloads.
  - Added Customer coverage for company validation, individual/taxId rejection,
    exact DTO allowlist, update audit, all six permission gates, address/contact
    tenant isolation, demo seed, proxy cookie/session forwarding, UI 403 UX, and
    PatientGuardian application-level inertness.
  - Playwright E2E remains blocked because Playwright is not installed or
    configured; tasks updated to show explicit blocker instead of false ticks.
  - Fresh PostgreSQL migration and live application-path HTTP tenant-isolation
    evidence executed in CI run
    [`34605178149`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34605178149)
    for commit `c9cff6131b6036849d0899a5735e6a2a6a3be5fd`: migrations/seed
    applied, `pnpm db:live-verify` passed, and
    `apps/api/test/live-pg-isolation.e2e-spec.ts` reported 6/6 passed with
    byte-equivalent `404 NOT_FOUND` for cross-tenant Customer/Address/Contact
    mutations.
- PRD v1.3 architecture freeze and Complexity Budget.
- Typed Tenant Settings architecture.
- Minimal internal post-commit application events.
- Explicit reversal/correction policy.
- Data classification and retention baseline.
- Reproducible synthetic demo tenant/seed policy.
- EPIC-00 Foundation baseline:
  - pnpm/Turborepo workspace with `apps/web`, `apps/api`, `apps/worker`.
  - Shared strict TypeScript, ESLint, Prettier, and Vitest configurations.
  - Docker Compose PostgreSQL 16 and Redis 7 with named volumes and configurable
    ports/credentials.
  - `infra/scripts/preflight.{sh,ps1}` reachability checks with named non-zero
    failures.
  - API `/health/live` endpoint with Zod environment validation and named
    missing-variable exit.
  - Web `HealthIndicator` polling `NEXT_PUBLIC_API_URL/health/live` via TanStack
    Query.
  - Worker Redis ping bootstrap, shared typed event envelope/dispatcher, and
    guarded demo-seed CLI.
  - GitHub Actions CI running lint, format-check, typecheck, test, and build on
    every PR.
  - Neutral `CoreDesignDefaults` branding stub and documentation of the deferred
    `Clinical Precision` Veterinary preset.
  - Authorized no-push Git baseline; `docs/_templates` remains the Obsidian
    template folder.

### Changed

- EPIC-06 Clinical closure reconciliation (docs-only): the epic and story
  records moved to `done`, and roadmap, module index, changelog, and
  OpenSpec-context references were reconciled against canonical post-merge CI
  run
  [`34793644348`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34793644348)
  at `ff786138`, paired with the archived EPIC-06 verification report. `done`
  means epic implementation closure only — it is **not** production readiness.
  [[EPIC-20]] Production Hardening and the open Tech Debt items remain;
  [[TD-006]] stays open for its broader gates and [[TD-011]] stays separate.
- EPIC-02, EPIC-03, and EPIC-04 closure reconciliation (docs-only): epic records
  moved to `done`, the missing `docs/01-roadmap/EPIC-04-Customers.md` record
  created, and roadmap, changelog, module, and OpenSpec-context references
  reconciled against canonical CI run
  [`34605178149`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34605178149)
  at `c9cff613`. `done` means epic implementation closure only — it is **not**
  production readiness. [[EPIC-20]] Production Hardening and the open Tech Debt
  items (TD-001, TD-006, TD-009, TD-010) remain; TD-007 and TD-008 stay
  accepted.

### Fixed

### Security
