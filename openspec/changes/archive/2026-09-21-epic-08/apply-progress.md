# Apply Progress: EPIC-08 — Portal

Change: `epic-08`. Artifact store: **hybrid (OpenSpec + Engram)**
(`sdd/epic-08/apply-progress`). Mode: **Standard** (`openspec/config.yaml`
`strict_tdd: false`; no strict-TDD module loaded). Delivery strategy:
**auto-forecast resolved to chained delivery**; chain strategy:
**feature-branch-chain** (resolved by the orchestrator). WU1 is split for review
into WU1A then WU1B; their eventual bases are the EPIC-08 integration/tracker
branch and the PR1 branch. No branch, commit, push, or PR action was performed.

Batches: **WU1 — Data/settings** (tasks 1.1–1.3) and **WU2 — Identity/boundary**
(tasks 2.1–2.3, implemented and uncommitted). Canonical files:
`openspec/changes/epic-08/{tasks.md,apply-progress.md}`.

## Completed Tasks (WU1 — Data/settings)

- [x] 1.1 RED — tests pin the portal persistence surface before the DDL:
      `packages/database/src/portal.test.ts` (28 tests: enums, composite
      tenant-ownership FKs + key-before-FK ordering, partial unique active
      holder, shared-PK credential, session TTLs/CASCADE, pending booking
      request, `Appointment.source` default, portal actor) and the PORTAL
      derivation tests in `packages/database/src/audit-log.test.ts`.
- [x] 1.2 GREEN — additive migration
      `packages/database/prisma/migrations/20260916000001_portal/migration.sql`
      plus the schema models/indexes; `packages/database/src/audit-log.ts` actor
      attribution now understands `PORTAL`.
- [x] 1.3 Seeds + typed namespace — portal permission catalog/grants in
      `packages/database/src/reference-seed.ts`, a synthetic holder + pending
      request in `packages/database/src/demo-seed.ts` (wired into
      `prisma/demo-seed.ts`), and the `portal` namespace in
      `apps/api/src/settings/registry.ts`; tests cover defaults, invalid value,
      and the namespace write permission.

## Files Changed — WU1

| File                                                                      | Action   | What Was Done                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                  | Modified | `CustomerPortalAccess` gains `customerId` + composite tenant FK and relations; new `PortalCredential`, `PortalSession`, `PortalBookingRequest` models and `AppointmentSource`/`PortalBookingRequestStatus` enums; `Appointment.source` (default `STAFF`) + nullable unique `portalBookingRequestId`; `AuditActorType.PORTAL` + `AuditLog.actorPortalAccessId`; `Customer.@@unique([tenantId, id])` and back-relations on `Customer`/`Patient`/`Tenant`. |
| `packages/database/prisma/migrations/20260916000001_portal/migration.sql` | Created  | Additive DDL: `ADD VALUE 'PORTAL'`, two enums, three new tables, composite tenant-ownership FKs (RESTRICT; one CASCADE for sessions), partial unique active-holder index, `appointment` provenance column + nullable unique provenance index, `audit_log` portal actor FK, ordered so referenced unique keys precede their FKs.                                                                                                                         |
| `packages/database/src/audit-log.ts`                                      | Modified | `AuditActorType` union + default derivation now include `PORTAL` via `actorPortalAccessId`.                                                                                                                                                                                                                                                                                                                                                             |
| `packages/database/src/audit-log.test.ts`                                 | Modified | Pins PORTAL derivation, explicit PORTAL actor type, and malformed portal-id rejection.                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/database/src/portal.test.ts`                                    | Created  | 28 migration/schema/seed tests for the portal foundation.                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/database/src/reference-seed.ts`                                 | Modified | `portal.access.manage` + `portal.settings.manage` catalog keys granted to OWNER/ADMIN.                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/database/src/reference-seed.test.ts`                            | Modified | Permission volume 26 → 28.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/database/src/demo-seed.ts`                                      | Modified | `seedDemoPortal` (synthetic ACTIVE holder + PENDING request, one transaction, idempotent) with structural client contracts and fixed ids.                                                                                                                                                                                                                                                                                                               |
| `packages/database/prisma/demo-seed.ts`                                   | Modified | Wires `seedDemoPortal` into the guarded entrypoint and extends the run log.                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/database/src/schema-clinical.test.ts`                           | Modified | `(tenantId, id)` tenant-ownership key count 5 → 7 (Customer, PortalBookingRequest).                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/database/src/schema-conventions.test.ts`                        | Modified | Shared-PK exception set now includes `PortalCredential`.                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/database/src/schema-inventory.test.ts`                          | Modified | `customer_portal_access` is no longer inert scaffolding; Branch stays schema-only.                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/api/src/settings/registry.ts`                                       | Modified | `portal` namespace (v1, closed `{ bookingRequiresApproval: boolean }`, default `true`, `requiresFeature: "portal"`, `portal.settings.manage`).                                                                                                                                                                                                                                                                                                          |
| `apps/api/src/settings/registry.test.ts`                                  | Modified | Three-namespace registry + portal defaults/feature/key/schema cases.                                                                                                                                                                                                                                                                                                                                                                                    |
| `apps/api/src/settings/tenant-settings.service.test.ts`                   | Modified | Portal write allowed with key + entitlement; denied without entitlement.                                                                                                                                                                                                                                                                                                                                                                                |

SDD artifacts updated: `openspec/changes/epic-08/tasks.md` (1.1–1.3 marked
`[x]`); this `apply-progress.md`; Engram twins `sdd/epic-08/tasks` and
`sdd/epic-08/apply-progress`.

## Verification Evidence — WU1 (focused)

| Command                                                                                                                                                                                     | Result                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm --filter @newsaas/database exec prisma validate`                                                                                                                                      | exit 0 — schema valid                                            |
| `pnpm --filter @newsaas/database build`                                                                                                                                                     | exit 0 — `prisma generate` + `tsc` + client copy                 |
| `pnpm --filter @newsaas/database typecheck`                                                                                                                                                 | exit 0 — no errors                                               |
| `pnpm --filter @newsaas/database lint`                                                                                                                                                      | exit 0 — no errors                                               |
| `pnpm --filter @newsaas/database test`                                                                                                                                                      | exit 0 — 12 files, **176 passed** (incl. `portal.test.ts` 28/28) |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/settings/tenant-settings.service.test.ts src/settings/registry.test.ts src/settings/settings.integration.test.ts` | exit 0 — 3 files, **46 passed**                                  |
| `pnpm --filter @newsaas/api test`                                                                                                                                                           | exit 0 — 55 passed / 1 skipped, **548 passed / 26 skipped**      |
| `pnpm --filter @newsaas/api typecheck`                                                                                                                                                      | exit 0 — no errors                                               |
| `pnpm --filter @newsaas/api lint`                                                                                                                                                           | exit 0 — no errors                                               |
| `pnpm exec prettier --check <15 changed files>`                                                                                                                                             | exit 0 — all match Prettier style                                |

`.prisma` and `.sql` have no inferred Prettier parser; they are excluded from
`prettier --check .` exactly like the existing migrations.

## Live-PostgreSQL Evidence — WU1 (throwaway `postgres:16-alpine`, port 55432)

The migration and demo seed were applied against a real PostgreSQL 16 (Docker
container, removed afterward):

| Check                                                                            | Result                                                                                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate deploy`                                                          | All migrations applied, including `20260916000001_portal`                                                                                             |
| `db:seed` + `ENABLE_DEMO_SEED=true NODE_ENV=development tsx prisma/demo-seed.ts` | 1 portal holder + 1 pending portal booking request created                                                                                            |
| `audit_actor_type` enum                                                          | `{STAFF,SYSTEM,PORTAL}`                                                                                                                               |
| `appointment_source` enum / column                                               | `{STAFF,PORTAL}`; `source` NOT NULL DEFAULT `'STAFF'`, `portal_booking_request_id` nullable                                                           |
| Partial unique index                                                             | `customer_portal_access_active_customer_key ... WHERE status = 'ACTIVE'`; second ACTIVE holder rejected with duplicate key, a REVOKED holder accepted |
| Provenance / audit wiring                                                        | `appointment_tenant_id_portal_booking_request_id_key` + `audit_log_actor_portal_access_id_fkey` present                                               |

## Deviations from Design

- Design D1 left the `CustomerPortalAccess.status` lifecycle without a dedicated
  enum. It stays the scaffold's `String` (`'ACTIVE' | 'REVOKED'`) to keep the
  migration strictly additive, matching the design's enumerated additive
  changes. The one-active-holder rule is enforced by the partial unique index,
  not a type.
- The migration adds a `DEFAULT CURRENT_TIMESTAMP` to the new tables'
  `updated_at`, mirroring the most recent migrations
  (patients/clinical/scheduling) even though Prisma's `@updatedAt` is
  client-set. This is a formatting/DDL convention choice with no behavioral
  impact.
- `CustomerPortalAccess` does not carry a `@@unique([tenantId, id])`: nothing
  references it through a composite tenant key, so it was omitted to avoid an
  unused key.

## Issues Found

- None functional. The migration depends on `customer(tenant_id, id)`; the
  unique key is created in this same migration before its composite FKs, so no
  cross-migration ordering dependency is introduced.
- `packages/database` is consumed by `apps/api` through its built `dist`; the
  package was rebuilt locally so the API picks up the new permission catalog and
  registry guard.

## Remaining Tasks

- [x] 2.1–2.3 WU2 — portal identity/guard (credential/session,
      `PortalAuthGuard`, route fence, provisioning/revocation, isolation tests).
      Implementation complete; review slices and live-PG evidence remain
      pending.
- [ ] 3.1–3.3 WU3 — portal read surface + web proxy. Not started.
- [ ] 4.1–4.3 WU4 — booking/profile/UI. Not started.
- [ ] 5.1–5.3 WU5 — live-PG evidence, probe pin, root gates, docs/Decision. Not
      started; the PRD §8 deviation Decision and `docs/05-modules/Portal.md`
      remain WU5 deliverables and were intentionally not created here.

## Review-Slice Delivery Plan (revised after re-verification)

The stable WU1 candidate against `74820e5` is 1,159 additions + 74 deletions =
1,233 changed lines. It exceeds the 800-line budget by 433; it is not eligible
as one review/commit unit. This plan allocates every existing WU1 hunk without
changing requirements or claiming commits.

| Slice                        | Intended relationship             | Exact ownership                                                                                                                                                                                                                                                                                                                                                           | Evidence allocated                                                                                                                         | Estimated diff                                  |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| WU1A: schema/migration/audit | PR1 base = feature/tracker branch | Full portal hunks in `packages/database/prisma/schema.prisma` and `migrations/20260916000001_portal/migration.sql`; full hunks in `src/audit-log.ts`, `audit-log.test.ts`, `schema-clinical.test.ts`, `schema-conventions.test.ts`, `schema-inventory.test.ts`; create `src/portal.test.ts` lines 1–2 and 18–240 (schema imports + migration/schema inventory describes). | Database test (migration/schema/audit subset), database typecheck/build, `prisma migrate deploy`; do not claim demo/API settings evidence. | 727 changed lines (658 additions, 69 deletions) |
| WU1B: seeds/settings         | PR2 base = PR1 branch             | Add `src/portal.test.ts` lines 3–16 and 242–420 (seed imports, reference-seed describe, fake); full portal hunks in `src/demo-seed.ts`, `src/reference-seed.ts`, `src/reference-seed.test.ts`, `prisma/demo-seed.ts`, `apps/api/src/settings/registry.ts`, `registry.test.ts`, `tenant-settings.service.test.ts`.                                                         | Database seed subset; API settings suite (35/35); synthetic demo seed. It relies on WU1A tables/models.                                    | 432 changed lines (427 additions, 5 deletions)  |

Rollback: revert WU1B restores only demo/catalog/settings behavior; revert WU1A
restores the additive DDL, Prisma contract, and audit attribution. Each child PR
must show only its listed slice; retarget/rebase if a previous slice appears.
WU2 base = PR2, WU3 = PR3, WU4 = PR4, WU5 = PR5; their scope and open questions
remain unchanged.

## Workload / PR Boundary

- Mode: feature-branch-chain; WU1A then WU1B are planned review slices, not
  commits. WU1A owns the prerequisite schema/migration/audit contract; WU1B owns
  its seed/settings consumers. No runtime identity, routes, or UI are included.
- No `size:exception` is requested. Existing rows remain unaffected by the
  additive `Appointment.source` default (`STAFF`).

## Diff Provenance — WU1

This is a traceability record, not a claim that the current checkout contains
review commits. `HEAD` is `74820e5`; all 15 WU1 paths remain unstaged/untracked.
No WU1 file was staged, reverted, committed, branched, or moved to establish the
re-verification or this review plan.

| Classification         | Paths                                                                                                                                                                                                                                                                                            | Review treatment                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WU1 candidate manifest | The 15 paths in **Files Changed — WU1** above                                                                                                                                                                                                                                                    | Review only the WU1A/WU1B hunk ownership above. The verifier captured stable candidate `sha256:3eddc315bafaadc60f379347b3a542fea47518f3cd334f8ba34a3f147a3b3dfe`; see `verify-report.md`. |
| Shared WU1 files       | `packages/database/prisma/schema.prisma`; `packages/database/src/demo-seed.ts`; `packages/database/prisma/demo-seed.ts`; `packages/database/src/{schema-clinical,schema-conventions,schema-inventory}.test.ts`; `apps/api/src/settings/{registry,registry.test,tenant-settings.service.test}.ts` | Split only at the listed WU1A/WU1B hunks; do not use a whole-file diff for a child-slice budget.                                                                                          |
| Other dirty paths      | Every changed or untracked path outside the 15-path manifest                                                                                                                                                                                                                                     | Excluded from WU1 review, including local `.codegraph/` metadata and unrelated documentation.                                                                                             |

The verifier's bounded autonomous candidate is 1,233 changed lines against
`74820e5`; the clean EPIC-07 predecessor is now committed. The review-budget
warning is addressed by the WU1A/WU1B plan above.

## WU2 delivery replanning (2026-09-15)

WU2 implementation is complete but remains **uncommitted** at exactly 2,240
changed lines (2,232 additions, 8 deletions) against `e8f12d4`; no size
exception is requested. It is automatically split for the 800-line
feature-branch chain:

| Slice      | Base        | Ownership / estimate                                                                                                         | Verification and rollback                                         |
| ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| WU2A / PR3 | WU1B branch | `portal/{constants,session-cookie,session.service}.ts`; `test/support/{in-memory-database,seed-portal}.ts` — 553.            | API typecheck; revert session/harness only.                       |
| WU2B / PR4 | PR3 branch  | Portal auth files, auth-only `portal.module.ts` hunk, app/auth/context/route/three-guard hunks, auth-test lines 1–177 — 703. | Focused portal-auth test; revert guard/auth boundary.             |
| WU2C / PR5 | PR4 branch  | Portal access files, access-module hunk, access test, auth-test lines 178–313 — 743.                                         | Focused auth/access tests; revert staff commands.                 |
| WU2D / PR6 | PR5 branch  | Route-contract probe portal hunk plus full live-PG portal block — 241.                                                       | Probe + **required real PostgreSQL evidence**; revert tests only. |

WU2B's module hunk registers only auth services/controller/guard; WU2C adds the
access services/controller. Retarget/rebase any child whose diff includes its
parent. Live-PG was not executed, so WU2D is pending evidence and no slice is
committed.

## Status

WU1 tasks 1.1–1.3, WU2 tasks 2.1–2.3 and WU3 tasks 3.1–3.3 are implemented.
WU1/WU2 and the live-PG evidence are committed and published as the open chain
PRs #19–#25. WU3 is published as #26 (WU3A `d6a8c78`), #27 (WU3B `df9a592`) and
#28 (WU3C `3e42f90`). Every PR in the chain carries both required checks green.

Live-PG evidence is no longer pending. The `Database migrations` CI job runs
`pnpm test:live-pg` against a PostgreSQL 16 service and reached 35 tests passed
on the PR #28 run; the `quality` job skips those same 35 tests by design because
it has no `DATABASE_URL_TEST`.

This supersedes the 2026-09-15 WU2 replanning note above, which predates the
chain publication and the chained-PR CI trigger.

WU4 (booking, profile and portal UI) and WU5 (hardening, root gates and
documentation) are now **merged**, not pending. The earlier WU1-batch snapshot
above ("Not started") is historical and is superseded by the reconciliation
below; it records the state at the WU1 session, not at merge time.

## Reconciled WU4/WU5 Closure (recorded at archive time)

This section reconciles the stale residual claims in this log with the merged
state at `27bc04a` (merge of PR #53, the final EPIC-08 slice). No new work is
claimed: each item is backed by merged commits/PRs or the epic's own records
(`docs/01-roadmap/EPIC-08-Portal.md`, `docs/10-qa/CI-EVIDENCE.md`,
`docs/05-modules/Portal.md`).

- **WU4 (booking, profile and UI) — merged.** Delivered as the chained PRs
  #29–#52: profile self-service (`portal-profile.integration.test.ts`, PR #35),
  booking request/approval (`portal-booking*`, `booking-requests*`), holder
  cancel/reschedule (`portal-appointment-write.integration.test.ts`, PRs #50,
  #51, #52) and the portal pages for pets, pet detail, appointments and booking
  (PRs #43–#52).
- **WU5 (hardening, root gates and documentation) — merged.** PR #53 (`f222816`)
  pins the live-PostgreSQL write concurrency and isolation evidence in
  `apps/api/test/live-pg-isolation.e2e-spec.ts`; the suite is **40/40 passed**
  at `27bc04a`. Both required CI jobs are `success` at that SHA
  (`docs/10-qa/CI-EVIDENCE.md` → "EPIC-08 Closure Baseline").
- **Recorded limitation (not a completed task).** The phase-4.3 "profile page"
  was **not** created: there is no holder-facing profile page or client
  function. The profile read/write lives only on the API
  (`GET|PUT /portal/profile`) and the proxy can forward it; `PortalNav` links
  only home, pets and appointments. This is documented as a merged-state
  limitation in `docs/05-modules/Portal.md` → "Known Limitations", and task 4.3
  is left unchecked in `tasks.md` for that reason.
- **Decision records.** [[DEC-007]] (merged, PR #39) settled the availability
  union, portal booking and staff-assigned professional; [[DEC-008]] records the
  PRD §8 deviation, the deferrals, classification, rollback and both resolved
  design questions. DEC-008 and `docs/05-modules/Portal.md` are part of the
  closure documentation set committed separately from the archive move.

Nothing in this section changes the historical WU1/WU2/WU3 snapshots above,
which are retained as the chronological apply log.
