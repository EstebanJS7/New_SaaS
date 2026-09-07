# Tasks: EPIC-02 — RBAC Enforcement / Entitlements / Tenant Settings

## Review Workload Forecast

| Field                        | Value                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Estimated changed lines      | 2,400–3,000 total — Batch A ≈1,200–1,450 · Batch B ≈900–1,170 · Batch C ≈280–380 |
| 400-line budget risk         | High (whole change); per batch: A High, B High, C Low                            |
| Chained PRs recommended      | No — TURBO review batches substitute (EPIC-01 precedent)                         |
| Suggested split              | Batch A (A1 → A2) → Batch B (B1 → B2) → Batch C                                  |
| Delivery strategy            | exception-ok — TURBO approved through archive                                    |
| Chain strategy               | size-exception                                                                   |
| Decision needed before apply | No                                                                               |

Batch review policy (maintainer-approved): batches are the review-slicing unit.
**Batch A is security-relevant → deep review MANDATORY** (global guard chain,
deny-by-default contract, admin authz + audit trail). Batch B gets full review
(write path hosts the first entitlement gate); Batch C is docs.

### Suggested Work Units

| Unit     | Goal                                                            | Likely commit | Focused test command                                                                               | Runtime harness                                              | Rollback boundary                                                  |
| -------- | --------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| A1 (1.x) | Deny-by-default guard + probe + annotations + `/me/permissions` | Batch A · c1  | `pnpm --filter @newsaas/api exec vitest run src/rbac src/tenancy`                                  | `bootTestApp` suites (in-memory Prisma boundary, per TD-006) | Remove `RbacModule` import ⇒ two-link chain restored               |
| A2 (2.x) | Audited RBAC administration API                                 | Batch A · c2  | `pnpm --filter @newsaas/api exec vitest run src/rbac` + isolation spec                             | Same harness + audit-log assertions                          | Delete admin controller/service files                              |
| B1 (3.x) | Settings storage + typed service core                           | Batch B · c1  | `pnpm --filter @newsaas/api exec vitest run src/settings` + `pnpm --filter @newsaas/database test` | CI `migrations` job (fresh PG16 deploy)                      | Migration down + remove `SettingsModule`                           |
| B2 (4.x) | Settings HTTP + entitlements gate + seeds                       | Batch B · c2  | `pnpm --filter @newsaas/api exec vitest run src/settings src/entitlements`                         | `bootTestApp` + explicit-grant fixtures                      | Revert seed lines + registry append; delete controller + gate step |
| C (5.x)  | Docs, DEC-003, full gates                                       | Batch C · c1  | `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`                      | Root gates + `pnpm services:up && pnpm preflight`            | n/a (docs only)                                                    |

## Batch A — Enforcement + Administration (S1+S2) · SECURITY-RELEVANT: deep review

### Unit A1 — S1 enforcement mechanism

- [x] 1.1 **PROBE-DECISION (do first)**: spike both dependency-free route
      enumerators — Fastify `printRoutes()` output parse vs Nest DI container
      traversal — in a throwaway test; PICK ONE for the probe, record the
      choice + rationale in a code comment atop
      `apps/api/src/rbac/route-contract.probe.test.ts` (tick design.md Open
      Questions at 5.5). Verify: scratch run enumerates every registered route.
      Deps: —.
- [x] 1.2 **roleId plumbing**: add optional `roleId` to `RequestContext`
      (`packages/shared/src/context.ts`) and to the ALS store +
      `setTenantMembership()`
      (`apps/api/src/context/request-context.service.ts`); include `role.id` in
      `resolveActiveForProfile` and expose `ActiveMembershipResolution.roleId`
      (`apps/api/src/tenancy/tenant-membership.repository.ts`); forward it in
      `apps/api/src/tenancy/tenant-active.guard.ts`. Verify:
      `pnpm --filter @newsaas/api exec vitest run src/tenancy` green (no
      behavior change). Deps: —.
- [x] 1.3 **Guard trio**: create `apps/api/src/rbac/` —
      `require-permissions.decorator.ts` (metadata key `ns:require-permissions`,
      factory `RequirePermissions(...keys)`; EMPTY call stores `[]` =
      authenticated-only; present-empty ≠ absent),
      `permission-resolver.service.ts` (ONE indexed query/request: ALS `roleId`
      → key set; extracted for reuse by 1.5/4.4; unit-test AND/subset logic),
      `permission.guard.ts` (third link; `@Public` + `/auth/*` skip parity;
      absent metadata ⇒ `DomainError("FORBIDDEN")` pre-handler; missing upstream
      context ⇒ `UNAUTHENTICATED`/`FORBIDDEN` fail-closed; multiple keys = AND;
      ZERO roleCode/profile bypass branches), `rbac.module.ts` registering
      APP_GUARD. Verify: `vitest run src/rbac`. Deps: 1.2.
- [x] 1.4 **Wire third link**: import `RbacModule` in
      `apps/api/src/app.module.ts` strictly AFTER `TenancyModule` (update
      ordering comment); extend `apps/api/src/tenancy/tenancy.wiring.test.ts` to
      assert Auth < Tenancy < Rbac source order + APP_GUARD presence. Verify:
      `vitest run     src/tenancy/tenancy.wiring.test.ts`. NOTE: membership-read
      suites may red until 1.5 lands (same unit). Deps: 1.3.
- [x] 1.5 **Annotate existing + effective endpoint**: in
      `apps/api/src/tenancy/membership.controller.ts` decorate
      `GET     /memberships` and `GET /memberships/:id` with
      `@RequirePermissions("users.membership.manage")`; add
      `GET     /memberships/me/permissions` with EMPTY declaration returning
      `{ permissions: string[] }` sorted, resolved via PermissionResolver.
      Verify: `vitest run src/tenancy src/rbac`. Deps: 1.4.
- [x] 1.6 **Route-contract probe (RED→GREEN)**: create
      `apps/api/src/rbac/route-contract.probe.test.ts`: boot real AppModule via
      `bootTestApp()`, enumerate via the 1.1 accessor, bucket every route:
      public-exempt (`@Public`, `/auth/*` — replicate prior guards' skip rules)
      / declared (metadata present, incl. `[]`) / VIOLATION; any violation fails
      the suite NAMING the route. Runtime twin: synthetic undeclared route ⇒ 403
      `FORBIDDEN` envelope, handler spy never executes. Verify: probe green over
      the whole API. Deps: 1.5.
- [x] 1.7 **`/me/permissions` integration**: user with memberships in two
      tenants holding different roles sees exactly each active tenant role's key
      set; anonymous call ⇒ 401 `UNAUTHENTICATED`. Verify:
      `vitest run     src/rbac`. Deps: 1.5.
- [x] 1.8 **Enforcement behavior suite**: single key denies members lacking it;
      two declared keys = AND (holder of one still 403); request reaching guard
      without membership context fails closed; ADMIN mapping minus one granted
      key ⇒ 403 on a route requiring exactly that key (authority is DATA —
      mutate `RolePermission` row in test). Verify: `vitest run src/rbac`. Deps:
      1.6.

### Unit A2 — S2 audited administration

- [x] 2.1 **Catalog listings**: `apps/api/src/rbac/rbac-admin.controller.ts` +
      service: `GET /rbac/roles` (six seeded roles + current key sets, response
      DTOs — never raw Prisma models), `GET /rbac/permissions` (catalog
      listing); both `@RequirePermissions("users.membership.manage")`. Verify:
      roles-listed-with-keys integration case. Deps: 1.4.
- [x] 2.2 **Replace-set update**: `PUT /rbac/roles/:code/permissions` — only the
      six seeded role codes addressable (anything else ⇒ 404); payload keys
      validated ⊆ seeded catalog, else 400 `VALIDATION_FAILED` with stored set
      UNCHANGED; full REPLACE inside `$transaction`; capture sorted before/
      after key sets. Verify: full-replace-applied + unknown-key-rejected cases.
      Deps: 2.1.
- [x] 2.3 **Mapping audit row**: exactly ONE `AuditWriter.append` per successful
      replace — action `rbac.role_permissions_replaced`, targetType/targetId =
      role id, metadata `{before:[keys],after:[keys]}` sorted; actor + requestId
      auto-filled; GET listings emit ZERO rows (assert count). Verify:
      audit-count assertions. Deps: 2.2.
- [x] 2.4 **Membership role assignment**: `POST /memberships/:id/role`
      `{roleCode}` (zod enum of six codes): tenant-scoped update replacing the
      membership's SINGLE role (repository helpers in
      `tenant-membership.repository.ts`), foreign UUID ⇒ 404 `NOT_FOUND`; shared
      effective-holdership rule INSIDE the `$transaction`: after locking ALL
      ACTIVE memberships for the tenant in deterministic order, excluding the
      target's current role and applying the target role's post-write candidate,
      zero effective `users.membership.manage` holders ⇒ 409 `CONFLICT`.
      Cross-tenant cases join
      `apps/api/test/cross-tenant-isolation.e2e-spec.ts`. Verify:
      assignment-applied / last-admin-409-unchanged /
      second-admin-demotion-succeeds / cross-tenant-404. Deps: 1.4.
- [x] 2.5 **Assignment audit + surface fence**: audit row action
      `rbac.membership_role_assigned`, metadata `{before:"CODE",after:"CODE"}`,
      target = membership id, actor auto-filled; extend probe expectations:
      enumerated inventory contains NO route creating/editing/deleting
      Permission catalog entries or Role records. Verify: audit assertions +
      extended probe green. Deps: 2.4, 1.6.

## Batch A Corrections — adversarial security review (2026-08-25, Option A authorized)

- [x] C1 **CRITICAL-1 · per-tenant override layer**: migration
      `20260825000001_rbac_tenant_role_permission_overrides` +
      `TenantRolePermissionOverride` model (UNIQUE(tenant,role,key), index,
      RESTRICT FKs; roles stay global); `PermissionResolver` merges baseline ∪
      grants − denials per request; `GET /rbac/roles` returns tenant-effective
      sets; `PUT /rbac/roles/:code/permissions` re-targeted to replace the
      CALLER'S TENANT override set (ctx.tenantId-scoped) audited as
      `rbac.role_permissions_overridden`; NEW last-manager rule ⇒ 409 inside the
      same transaction.
- [x] C2 **CRITICAL-2 · effective-manager race**: `SELECT ... FOR UPDATE` over
      ALL ACTIVE membership rows for the current tenant, in deterministic order,
      BEFORE effective-holdership evaluation/mutation in BOTH flows; this is
      deliberately tenant-wide because overrides can make a non-admin role an
      effective manager. In-memory fake limitation documented honestly and
      TD-006 scope extended with a concurrency-proof evidence gate.
- [x] C3 **WARNING-1 · audit atomicity**: `AuditWriter.append(input, tx?)` joins
      the caller's `$transaction` in both mutation flows; tests updated.
- [x] C4 **WARNING-2 · DEC-003**:
      `docs/07-decisions/DEC-003-rbac-role-mapping-overrides.md` (status:
      accepted, 2026-08-25) records maintainer authorization, the
      platform-baseline/tenant-sandbox rationale, and the self-promotion
      accepted risk; PRD untouched.
- [x] C5 **Suggestions**: route-contract probe pins the FULL expected
      `METHOD path` inventory (exact-set equality, symmetric diff reporting);
      shared skip predicate extracted to `apps/api/src/rbac/route-contract.ts`
      consumed by BOTH PermissionGuard and probe.

## Batch A Final Correction — composed stranding gap (2026-08-26 re-judge)

- [x] F1 **Unified stranding predicate**: ONE shared implementation
      (`apps/api/src/rbac/manage-holdership.ts`,
      `assertEffectiveManageHolderExists`) used by BOTH `replaceRolePermissions`
      and `replaceRoleGuarded`: post-write there must exist ≥1 ACTIVE membership
      whose role's EFFECTIVE set holds `users.membership.manage`; evaluated
      inside each transaction after the FOR UPDATE lock; old admin-seat-count
      predicate removed.
- [x] F2 **W1 hardening**: the override replace flow acquires the FOR UPDATE
      lock BEFORE computing before/removesManage whenever the payload could
      remove the manage key (no stale pre-lock decision reads).
- [x] F3 **Spec unification**: "Last administrator protected" and "Last manager
      holder protected" merged into ONE invariant expressed once (Requirement:
      Shared retention invariant / effective-holdership); new composed-path
      scenario added; surviving scenario IDs stable.
- [x] F4 **Composed-path test**: real-HTTP integration test reproduces the
      reviewer repro (override-strip ADMIN then OWNER self-demote) ⇒ 409
      CONFLICT, state unchanged, zero audit rows for the rejected attempt;
      discrimination against the retired seat-count predicate documented in the
      test.
- [x] F5 **Retainer scan de-classed**: retention counts ANY active member whose
      effective set holds the key; the shared FOR UPDATE lock also targets ALL
      active memberships because effective holders may be non-admin through
      tenant overrides.
- [x] F6 **TD-006**: evidence gate extended to name transactional-audit
      atomicity (audit-in-tx rollback semantics) as a fake-unproven property;
      DEC-003 last-manager bullet amended to effective-holdership wording.

## Batch B — Settings Infrastructure + Entitlements Gate (S3)

### Unit B1 — storage + typed service core

- [x] 3.1 **Migration + model**: add `TenantSettingNamespace` to
      `packages/database/prisma/schema.prisma` VERBATIM per
      `docs/03-architecture/TENANT-SETTINGS.md`
      (`@@unique([tenantId,     namespace])`, `@@index([tenantId])`,
      `schemaVersion Int`, `data Json`, `@@map("tenant_setting_namespace")`);
      additive reversible migration (create-table only, no confirmed-data
      mutation). Verify: `prisma migrate     dev` locally; CI `migrations` job
      green on fresh PG16. Deps: —.
- [x] 3.2 **Typed registry**: create `apps/api/src/settings/registry.ts` (NOT
      packages/shared — backend enforcement material per D6): definitions
      `{namespace, version, schema: z.object({...}).strict(), defaults,     requiresFeature?, requiredPermissionKey}`;
      register EXACTLY ONE v1 namespace `sales` (`defaultCurrency`
      `/^[A-Z]{3}$/` default `"PYG"`; `requireCustomerForInvoice` boolean
      default false; `requiresFeature:"sales"`;
      `requiredPermissionKey:"sales.settings.manage"`); unknown-namespace lookup
      ⇒ `NOT_FOUND`; closed schemas make secret-shaped fields unpersistable.
      Union-sync test: every registry `requiredPermissionKey` ∈
      `PERMISSION_SEEDS`, every `requiresFeature` ∈ `FEATURE_CODE_SEEDS`.
      Verify: `vitest run src/settings` + database seed suite. Deps: —.
- [x] 3.3 **TenantSettingsService**:
      `apps/api/src/settings/tenant-settings.service.ts` + `settings.module.ts`:
      `get(ns)` = defaults ⊕ stored (stored values defensively re-parsed through
      schema); `update(ns, patch)` implements D5 order ① definition lookup
      (unregistered ⇒ `NOT_FOUND`) → ③ closed-schema validation (unknown field /
      wrong type ⇒ `VALIDATION_FAILED`, NOTHING persisted) → ④ upsert merged
      values stamped with registry `schemaVersion` (one row per
      `(tenantId, namespace)`), partial patches preserve siblings; tenant scope
      via `requireTenantId()`. Entitlement step ② arrives in 4.3. Verify:
      defaults-when-absent / unknown-field / wrong-type /
      partial-sibling-preserved / one-row-invariant / version-equals-N. Deps:
      3.1, 3.2.
- [x] 3.4 **Isolation + secrets cases**: cross-tenant row access by id or
      namespace behaves as nonexistent ⇒ 404 (extend
      `apps/api/test/cross-tenant-isolation.e2e-spec.ts`); secret-shaped patch
      (`{ "apiKey": "..." }`) ⇒ 400 `VALIDATION_FAILED`, nothing persisted.
      Deps: 3.3.

### Unit B2 — HTTP surface + gate + seeds

- [x] 4.1 **Error registry append**: add
      `FEATURE_NOT_ENTITLED: Object.freeze({ status: 403 })` to
      `packages/shared/src/errors/registry.ts` — append-only evolution, all
      existing entries byte-identical. Verify:
      `pnpm --filter @newsaas/shared test` (new code maps 403; old codes
      untouched). Deps: —.
- [x] 4.2 **Seed additions**: `packages/database/src/reference-seed.ts`:
      `PERMISSION_SEEDS += sales.settings.manage`; OWNER + ADMIN matrix rows
      gain it — purely ADDITIVE per D7 (rerun restores removed baseline pairs,
      preserves admin-added pairs; document in doc task 5.1). Verify: seed
      double-run probe / idempotency suite green. Deps: —.
- [x] 4.3 **Entitlements gate**: insert D5 step ② in
      `TenantSettingsService.update`: when definition declares
      `requiresFeature`, evaluate
      `EntitlementsService.has(tenantId,     featureCode)`; false ⇒
      `DomainError("FEATURE_NOT_ENTITLED")` BEFORE any persistence; READS never
      evaluate entitlements; ZERO grant-creating code paths added. Verify:
      write-no-grant denied (row untouched) / write-with-explicit-grant
      applied + readable. Deps: 4.1, 3.3.
- [x] 4.4 **Settings HTTP routes**:
      `apps/api/src/settings/settings.controller.ts`: `GET /settings/:namespace`
      EMPTY-declared (authenticated-only); `PUT /settings/:namespace` declares
      `sales.settings.manage`; service RE-ASSERTS
      `definition.requiredPermissionKey` via resolver — defense-in-depth so a
      forgotten decorator cannot fail open. Probe stays green (new routes
      declared). Verify: read-200-while-write-403-without-key / anonymous 401 /
      non-entitled tenant reads 200 defaults. Deps: 4.3, 4.2.
- [x] 4.5 **Gate integration consolidation**: booted-app flows with/without an
      explicit `tenant_entitlement` row for `sales`; starter-plan-maps-all-
      grants-nothing case (`has()` false AND gated write 403). Verify:
      `vitest run src/settings src/entitlements`. Deps: 4.4.

## Batch C — Documentation + Decisions + Gates (S4)

- [x] 5.1 **RBAC module doc**: create `docs/05-modules/RBAC.md` (frontmatter
      `type: module`, `status: implemented`): three-state route contract,
      deny-by-default, AND semantics, no-code-bypass rule, admin API + audit
      actions, `/me/permissions`, `<domain>.settings.manage` key-expansion
      convention, D7 seed-interaction statement (self-healing baseline); index
      it in `docs/05-modules/README.md`; Obsidian links [[EPIC-02]], delta-spec
      paths. Deps: Batch A. Evidence: `docs/05-modules/RBAC.md`.
- [x] 5.2 **Tenant-Settings flip**: `docs/03-architecture/TENANT-SETTINGS.md`
      frontmatter `status: planned → implemented`, `updated: 2026-08-26`;
      replace "Planned Capabilities" with shipped v1 reality (`sales` namespace,
      registry location, service API, entitlement gate order, expansion
      convention: new namespace ⇒ registry entry + decorator key + union-sync
      test). Deps: Batch B. Evidence: `docs/03-architecture/TENANT-SETTINGS.md`.
- [x] 5.3 **Roadmap epic file**: create
      `docs/01-roadmap/EPIC-02-RBAC-Entitlements-Tenant-Settings.md` mirroring
      the EPIC-01 file structure (frontmatter `prd_sections: ["9","10","38"]`,
      status, dependencies; Objective; Scope; Out of Scope: custom-role CRUD,
      plan/grant surfaces, UI screens, permission caching — escape-hatch note;
      acceptance criteria with evidence pointers; stories = work units; Known
      Limitations incl. [[DEC-003]] proposed). Deps: 5.1, 5.2. Evidence:
      `docs/01-roadmap/EPIC-02-RBAC-Entitlements-Tenant-Settings.md`.
- [x] 5.4 **DEC-003**: created early via Batch A corrections (C4) as
      `docs/07-decisions/DEC-003-rbac-role-mapping-overrides.md` — maintainer-
      authorized 2026-08-25, `status: accepted`, `prd_change_required: true`;
      documents the per-tenant override architecture replacing global mutable
      mappings. PRD text itself untouched. Deps: —.
- [x] 5.5 **FULL ROOT GATES (final)**: run
      `pnpm lint && pnpm format-check &&     pnpm typecheck && pnpm test && pnpm build`;
      focused filters `--filter @newsaas/{api,shared,database,web,worker}`;
      `pnpm services:up && pnpm preflight`; CI `migrations` job evidence; cite
      probe + seed-double-run + cross-tenant isolation suites; tick design.md
      Open Questions with the 1.1 probe-accessor outcome. All green ⇒ ready for
      sdd-verify/archive. Deps: ALL. Evidence: format-check exit 0; lint exit 0
      (12 packages); typecheck exit 0 (12 packages); test exit 0 (API 36 files /
      249 tests, database 6 files / 67 tests, shared 3 files / 16 tests, worker
      2 files / 12 tests, web 10 files / 32 tests, ui 6 files / 36 tests); build
      exit 0 (8 packages including web + api); `git diff --check` exit 0;
      `pnpm services:up && pnpm preflight` exit 0 (PostgreSQL + Redis
      reachable).

## Traceability Matrix — 35 scenarios (18 requirements), zero orphans

Specs: ENF=rbac-enforcement · ADM=rbac-administration ·
ENT=entitlements-enforcement · SET=tenant-settings

| #   | Spec | Scenario                                                 | Owner task(s)                 |
| --- | ---- | -------------------------------------------------------- | ----------------------------- |
| 1   | ENF  | Undeclared private route denied at runtime               | 1.6                           |
| 2   | ENF  | Route-contract probe blocks undeclared routes            | 1.6 (accessor pinned in 1.1)  |
| 3   | ENF  | Single key gates route                                   | 1.8                           |
| 4   | ENF  | Multiple keys mean ALL                                   | 1.8                           |
| 5   | ENF  | Wire order is pinned                                     | 1.4                           |
| 6   | ENF  | Missing upstream context fails closed                    | 1.8 (construction 1.3)        |
| 7   | ENF  | ADMIN authority is data, not code                        | 1.8                           |
| 8   | ENF  | Keys reflect active tenant membership                    | 1.7                           |
| 9   | ENF  | Anonymous access rejected (`/me/permissions`)            | 1.7                           |
| 10  | ADM  | Roles listed with mapped keys                            | 2.1                           |
| 11  | ADM  | Full replace applied                                     | 2.2                           |
| 12  | ADM  | Unknown catalog key rejected                             | 2.2                           |
| 13  | ADM  | No catalog or role mutation surface                      | 2.5                           |
| 14  | ADM  | Assignment changes membership role                       | 2.4                           |
| 15  | ADM  | Last effective manager holder protected                  | 2.4 (unified, F1/F3)          |
| 16  | ADM  | Second administrator enables demotion                    | 2.4                           |
| 17  | ADM  | Cross-tenant target invisible                            | 2.4                           |
| 18  | ADM  | Mapping update emits diff audit row                      | 2.3                           |
| 19  | ADM  | Assignment emits audit row                               | 2.5                           |
| 35  | ADM  | Override strip then self-demote composes into protection | F4                            |
| 20  | ENT  | Write without grant denied                               | 4.3 (booted-app proof 4.5)    |
| 21  | ENT  | Write with explicit grant allowed                        | 4.3 (booted-app proof 4.5)    |
| 22  | ENT  | Starter plan mapping grants nothing                      | 4.5                           |
| 23  | ENT  | Non-entitled tenant reads defaults                       | 4.4                           |
| 24  | SET  | One row per tenant and namespace                         | 3.3                           |
| 25  | SET  | Cross-tenant access returns 404                          | 3.4                           |
| 26  | SET  | Unregistered namespace rejected                          | 3.2 (enforced again in 3.3 ①) |
| 27  | SET  | Written rows carry the registry version                  | 3.3                           |
| 28  | SET  | Defaults returned when absent                            | 3.3                           |
| 29  | SET  | Unknown field rejected                                   | 3.3                           |
| 30  | SET  | Wrong-typed value rejected                               | 3.3                           |
| 31  | SET  | Partial patch preserves sibling fields                   | 3.3                           |
| 32  | SET  | Read allowed, write denied without key                   | 4.4                           |
| 33  | SET  | Anonymous read rejected                                  | 4.4                           |
| 34  | SET  | Secret-shaped payload rejected                           | 3.4                           |

## Execution Notes

- `strict_tdd: false` — tests land WITH each behavior (work-unit commits),
  RED→GREEN sequencing called out only where cheap (1.6).
- Every new private aggregate (settings rows, membership mutations) joins
  `apps/api/test/cross-tenant-isolation.e2e-spec.ts` per engineering rules.
- DTO rule: no raw Prisma models from public APIs; params/body zod-validated;
  errors ONLY via frozen registry codes + `DomainError`.
- Audit is fail-closed: `AuditWriter.append` errors propagate — a mutation never
  completes without its row.
- No new external dependencies (design constraint).
