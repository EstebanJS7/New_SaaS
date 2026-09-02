# Design: EPIC-04 — Customers (Core)

## Technical Approach

Tenant-scoped Customer Core (INDIVIDUAL|COMPANY) with child Address/Contact
aggregates and a schema-only `PatientGuardian` scaffold. Mirrors EPIC-03 Phase B
/ RBAC / Audit / Tenant: additive migration, structural-delegate service over
`PrismaService`, `requireTenantId()` as the only tenant authority,
`$transaction`-co-committed `AuditWriter.append()` with ID-only metadata,
allowlisted DTOs, `@RequirePermissions()` per command, Next.js route-handler
proxy forwarding session cookie + `x-request-id`. Customer fields are
CONFIDENTIAL; logs carry IDs only. `PatientGuardian`: `customerId` FK only — no
`patientId`/service/controller/route/portal/UI.

## Architecture Decisions

| #   | Option                                                                                                                                               | Decision                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| D1  | `Customer.kind` enum; `displayName` required; Zod refinement rejects kind-mismatched fields                                                          | Enum + refinement — one table, one DTO, one audit row    |
| D2  | `isActive` + dedicated `POST .../deactivate`; idempotent; no hard delete                                                                             | Soft deactivate via command                              |
| D3  | `PatientGuardian` with `customerId` FK + UNIQUE(customer_id, position); no `patientId`/service/controller/route/portal/UI                            | Inert scaffold — pin via test asserting zero app imports |
| D4  | Six permissions `customers.read/create/update/deactivate`, `customers.address.manage`, `customers.contact.manage`                                    | Six verbatim; DEC-003 overrides remain                   |
| D5  | Tenant identity only via `requireTenantId()`; cross-tenant UUID = 404 byte-equivalent to nonexistent                                                 | Reuse `expectCrossTenant404`                             |
| D6  | One `AuditWriter.append()` per mutation in same `$transaction`; metadata `{ schemaVersion, changedFields, reason? }` with stable IDs only            | Audit-or-nothing                                         |
| D7  | Sub-resource commands nest under `/customers/:id/...`; each carries its own `@RequirePermissions`; `customers.update` does NOT touch address/contact | Nested                                                   |
| D8  | Zod-inferred narrow DTOs; CONFIDENTIAL fields returned but never logged                                                                              | Allowlist                                                |
| D9  | `next/link` to `/app/customers`; semantic Customer entry in `NavSidebar`; route-handler proxies mirror API verbs                                     | Reuse `/api/branding/current` proxy helper               |

## Data Flow

```
Staff web ── cookies() ── /api/customers/* (Next route handler)
                              │  cookie + x-request-id forwarded
                              ▼
                         API /customers/* (NestJS)
                              │  AuthGuard → TenantActiveGuard → PermissionGuard
                              ▼
                         CustomersService (delegate)
                              │  $transaction: write + AuditWriter.append()
                              ▼
                         Postgres ── audit_log + customer/customer_address/customer_contact
```

Default `GET /customers` filters `isActive=true`.

## File Changes

| Path                                                                                                                                                                                                                         | Action                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma` + `migrations/<ts>_customers/migration.sql`                                                                                                                                         | Modify/Create — enums + 4 models + additive CREATE TABLE × 4 + FK + indexes |
| `packages/database/src/reference-seed.ts` + `.test.ts` + `demo-seed.ts` + `demo-seed.test.ts`                                                                                                                                | Modify — six `customers.*` keys + role baseline + synthetic seed            |
| `apps/api/src/customers/{customers.module,customers.service,customers.controller,customer-addresses.controller,customer-contacts.controller,customer.dto,customer-address.dto,customer-contact.dto,customer.zod}.ts` + tests | Create                                                                      |
| `apps/api/src/app.module.ts` + `rbac/route-contract.probe.test.ts`                                                                                                                                                           | Modify — register module; +11 routes                                        |
| `apps/web/src/app/api/customers/...` (9 route handlers) + `apps/web/src/app/(app)/app/customers/*` + `components/shell/nav-sidebar.tsx`                                                                                      | Create/Modify — proxy, pages, nav                                           |
| `docs/05-modules/Customers.md`, `docs/09-releases/CHANGELOG.md`                                                                                                                                                              | Modify                                                                      |

## Interfaces / Contracts

```ts
// customer.dto.ts — allowlisted CONFIDENTIAL; no PII in errors/logs
export interface CustomerResponse {
  readonly id: string; readonly tenantId: string;
  readonly kind: "INDIVIDUAL" | "COMPANY"; readonly displayName: string;
  readonly legalName: string | null; readonly taxId: string | null;
  readonly firstName: string | null; readonly lastName: string | null;
  readonly documentNumber: string | null;
  readonly isActive: boolean; readonly createdAt: string; readonly updatedAt: string;
}
// customer.zod.ts — discriminated union + refinement rejects kind-mismatched fields
export const createCustomerBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("INDIVIDUAL"), displayName: z.string().min(1).max(200),
             firstName?, lastName?, documentNumber? }),
  z.object({ kind: z.literal("COMPANY"),   displayName: z.string().min(1).max(200),
             legalName: z.string().min(1), taxId: z.string().min(1).max(32) }),
]).superRefine(/* reject kind-mismatched fields */);
```

## Testing Strategy

| Layer       | What                                                                                                                                                                                        | How                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Unit        | Zod refinements, DTO allowlist, soft-deactivate idempotency, `PatientGuardian` has no app imports                                                                                           | Vitest                                       |
| Integration | Two-tenant + Supertest: cross-tenant 404 byte-equivalence, permission gate per six keys, audit co-commit (one AuditLog per mutation), web proxy cookie forwarding, route-contract exact-set | Vitest + Supertest                           |
| Schema      | `PatientGuardian` inert; FK indexes; migration additive                                                                                                                                     | `schema-conventions.test.ts` + scaffold test |
| E2E         | Playwright customer CRUD + nav                                                                                                                                                              | H1 combined hardening                        |

## Threat Matrix

N/A — no shell/subprocess/VCS-PR/exec-file/process integration. Reuses
`PermissionGuard` + `TenantActiveGuard`; probe extended with 11 routes.

## Migration / Rollout

Additive migration; every tenant starts empty. Pre-data rollback: revert chained
PRs in reverse. Post-data: keep rows + audit; disable by route removal.

## Open Questions

- [ ] Address/contact soft-deactivation shape: **Plan: align with Customer
      `isActive`+command (D2)**.
- [ ] `taxId` uniqueness per tenant: deferred to SIFEN-driven later change.

## Slices / Forecast

| Slice                                  | Goal                                                                                                                                           | LOC  | Risk |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- |
| S1                                     | Schema + migration + 6 permissions + role baseline + demo data                                                                                 | ≤350 | Low  |
| S2                                     | Customer API (service, controller, zod, DTO, module, audit)                                                                                    | ≤400 | Med  |
| S3                                     | Address/Contact API + route-contract probe update                                                                                              | ≤350 | Med  |
| S4                                     | Web UI + nav entry + 9 Next.js route-handler proxies                                                                                           | ≤400 | Med  |
| H1 (after EPIC-03 Phase B and EPIC-04) | Combined hardening: tests, root gates, live-PG migration/isolation evidence, security review, Playwright, docs sync, TD-006 — DoD NOT weakened | —    | —    |

Chain: **S1→S2→S3→S4 then H1**. S1-S4 are code-first slices with no per-slice
gates, tests, docs sync, review, or task ticking; H1 runs the mandatory
consolidated root gates, live-PG evidence, Playwright, security review, and
documentation sync after EPIC-03 Phase B and EPIC-04.
