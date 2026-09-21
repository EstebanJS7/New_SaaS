# Tasks: EPIC-08 — Portal

## Review Workload Forecast

| Field                   | Value                                                     |
| ----------------------- | --------------------------------------------------------- |
| Estimated changed lines | 5,040–5,840; WU1 1,233, WU2 2,240                         |
| 800-line budget risk    | High                                                      |
| Chained PRs recommended | Yes                                                       |
| Suggested split         | WU1A → WU1B → WU2A → WU2B → WU2C → WU2D → WU3 → WU4 → WU5 |
| Delivery strategy       | auto-forecast (resolved)                                  |
| Chain strategy          | feature-branch-chain (user-approved)                      |

Decision needed before apply: No Chained PRs recommended: Yes Chain strategy:
feature-branch-chain 400-line budget risk: High

WU1 boundary: persistence/settings foundation only (tasks 1.1–1.3). It owns the
portal schema/migration, audit actor attribution, portal seed/permissions, and
typed `portal` settings namespace. It does not include portal identity, routes,
read/proxy, booking/profile/UI, or WU2–WU5 work. The current worktree is not a
reviewable WU1-only diff; see `apply-progress.md` and `verify-report.md` for the
explicit 15-path candidate. Against `74820e5`, its stable candidate is 1,233
changed lines, so its already-implemented work is split below for review; no
commit, branch, or PR is asserted.

### Suggested Work Units

| Unit | Goal                   | Likely PR / base | Focused test            | Harness         | Rollback         |
| ---- | ---------------------- | ---------------- | ----------------------- | --------------- | ---------------- |
| WU1A | Schema/migration/audit | PR1 → tracker    | database test           | migrate deploy  | DDL + audit      |
| WU1B | Seeds/settings         | PR2 → PR1        | database + API settings | demo seed       | seeds + registry |
| WU2  | Identity/guard         | PR3 → PR2        | API                     | cross-cookie    | auth boundary    |
| WU3  | Read/proxy             | PR4 → PR3        | API/web                 | proxy paths     | reads/proxy      |
| WU4  | Booking/profile/UI     | PR5 → PR4        | API                     | pending→approve | commands/pages   |
| WU5  | Hardening/docs         | PR6 → PR5        | root gates              | live-PG         | tests/docs       |

### WU1 Review-Slice Ownership

- [x] 1.1A PR1 (base: EPIC-08 tracker): migration/schema/audit hunks in
      `packages/database/prisma/{schema.prisma,migrations/20260916000001_portal/migration.sql}`;
      `src/{audit-log.ts,audit-log.test.ts,schema-clinical.test.ts,schema-conventions.test.ts,schema-inventory.test.ts}`;
      `portal.test.ts` lines 1–2 and 18–240. Verify database
      test/typecheck/build; migrate deploy.
- [x] 1.3A PR2 (base: PR1 branch): seed/settings hunks in
      `packages/database/src/{demo-seed.ts,reference-seed.ts,reference-seed.test.ts,portal.test.ts}`
      lines 3–16 and 242–420, `prisma/demo-seed.ts`, and
      `apps/api/src/settings/{registry.ts,registry.test.ts,tenant-settings.service.test.ts}`.
      Verify database test and API settings tests; run synthetic demo seed.

### WU2 Review-Slice Ownership (implemented, uncommitted)

| Slice / base           | Exact ownership                                                                                                                                                                                                                        | Estimate | Verification / rollback                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| WU2A / PR3 base = WU1B | Full `portal/{constants,session-cookie,session.service}.ts`; full `test/support/{in-memory-database,seed-portal}.ts`.                                                                                                                  | 553      | API typecheck; rollback session/test-harness additions.                            |
| WU2B / PR4 base = PR3  | Full `portal/{auth.service,auth.controller,auth.guard,dto}.ts`; auth-only hunk of `portal.module.ts`; `app.module.ts`, `auth.module.ts`, context, route-contract and three guard hunks; `portal-auth.integration.test.ts` lines 1–177. | 703      | Portal auth focused test; rollback isolated auth/guard boundary.                   |
| WU2C / PR5 base = PR4  | Full `portal/{access.service,access.controller,access.dto}.ts`; access-registration hunk of `portal.module.ts`; full `portal-access.integration.test.ts`; `portal-auth.integration.test.ts` lines 178–313.                             | 743      | Portal auth/access focused tests; rollback staff provisioning/revocation commands. |
| WU2D / PR6 base = PR5  | Full portal fence hunk of `rbac/route-contract.probe.test.ts`; full EPIC-08 block in `test/live-pg-isolation.e2e-spec.ts`.                                                                                                             | 241      | Probe test plus **live-PG evidence belongs here**; rollback evidence-only tests.   |

WU2A is a prerequisite harness slice; WU2B's auth-only `PortalModule` hunk must
exclude access imports/providers/controllers until WU2C. WU2D may be committed
only after a real PostgreSQL run records its five scenarios; it does not claim
that evidence today.

## Phase 1: Foundation (WU1)

- [x] 1.1 RED: test active-holder uniqueness, PORTAL audit actor, pending
      request, and `Appointment.source` default in
      `packages/database/prisma/schema.prisma`.
- [x] 1.2 GREEN: add additive
      `packages/database/prisma/migrations/20260916000001_portal/` and schema
      models/indexes; update `packages/database/src/audit-log.ts` actor
      attribution.
- [x] 1.3 Add portal permissions/seeds in
      `packages/database/src/{reference-seed,demo-seed}.ts` and the typed
      namespace in `apps/api/src/settings/registry.ts`; test defaults, invalid
      value, and write permission.

## Phase 2: Identity and boundary (WU2)

- [x] 2.1 RED: test portal context/guard, provision/revoke, entitlement, foreign
      404, second-holder 409, and cross-cookie 401 in
      `apps/api/src/portal/**/*.test.ts` and
      `apps/api/test/live-pg-isolation.e2e-spec.ts`.
- [x] 2.2 GREEN: create `apps/api/src/portal/**`; wire `PortalModule` in
      `apps/api/src/app.module.ts`, credential/session cookie, staff
      provision/revoke, atomic audit, and session invalidation.
- [x] 2.3 RED→GREEN: fence `/portal/*` only in
      `apps/api/src/rbac/{route-contract.ts,route-contract.probe.test.ts}` and
      `{auth,tenancy,rbac}/*.guard.ts`; keep staff admin declared.

## Phase 3: Read surface and proxy (WU3)

- [x] 3.1 RED: test allowlisted pet/appointment/vaccination DTOs,
      byte-equivalent 404, no `internalNotes` in responses/logs, and deferred
      404 in `apps/api/src/portal/**/*.test.ts`.
- [x] 3.2 GREEN: add tenant/holder-scoped read controllers/services in
      `apps/api/src/portal/**`; return CONFIDENTIAL projections with stable-ID
      logs only.
- [x] 3.3 RED→GREEN: create `apps/web/src/app/api/portal/[[...path]]/route.ts`
      and `apps/web/src/lib/session-cookie.ts`; allowlist UUID paths/query,
      reject `%`/unknowns, and forward only `PORTAL_SESSION_COOKIE`.

### WU3 delivery (published)

WU3 is committed and published as a three-slice chain on top of WU2D. All three
are CI green on both required checks (`Database migrations` and
`Lint, Typecheck, Test, Build`):

| Slice | Commit    | PR / base               | Ownership                                                                                                                                                                     |
| ----- | --------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WU3A  | `d6a8c78` | #26, base = WU2D branch | Read test boundary only: `apps/api/test/support/in-memory-database.ts`.                                                                                                       |
| WU3B  | `df9a592` | #27, base = WU3A        | Holder-owned pet reads: `portal-read.{controller,service,dto}.ts` plus `portal.module.ts` and the probe hunk.                                                                 |
| WU3C  | `3e42f90` | #28, base = WU3B        | Appointment reads (`GET /portal/appointments[/:id]`), the GET-only web proxy `apps/web/src/app/api/portal/[[...path]]/route.ts`, and the split staff/portal cookie constants. |

The slice evidence is 25 portal read integration tests, 14 web proxy tests, the
route-contract fence for both appointment routes, and the 185-test database
boundary gate.

Boundary guard gotcha: `packages/database/src/schema-branding-customers.test.ts`
rejects the literal `PatientGuardian` anywhere under `apps/api/src` or
`apps/web/src` outside a `patients/` path. Portal files must therefore name the
`patient_guardian` table, never the Prisma model. This cost one CI cycle on
WU3B.

## Phase 4: Booking, profile, and UI (WU4)

WU4 is merged as the chained PRs #29–#52, merged through `main` and closed at
`27bc04a` (merge of PR #53). Re-checked here against the merged code and the
epic's own records (`docs/01-roadmap/EPIC-08-Portal.md`,
`docs/10-qa/CI-EVIDENCE.md`).

- [x] 4.1 RED: cover bad range/service/email 400, non-owned 404,
      pending-not-overlap, repeated approval, staff permission, portal
      transition/approval 403, and exact audit rows in
      `apps/api/src/portal/**/*.test.ts` and
      `apps/api/test/live-pg-isolation.e2e-spec.ts`. Evidence:
      `portal-booking.integration.test.ts`,
      `portal-profile.integration.test.ts`,
      `portal-appointment-write.integration.test.ts`,
      `booking-requests.integration.test.ts`, and the EPIC-08 WU5 block in
      `live-pg-isolation.e2e-spec.ts` (PR #53, `f222816`).
- [x] 4.2 GREEN: implement strict profile, booking request, staff
      approve/reject, provenance, idempotency, and co-committed audit in
      `apps/api/src/{portal,scheduling,customers}/**`; emit no appointment
      events. Evidence: merged `apps/api/src/portal/**` and
      `apps/api/src/scheduling/booking-request*.ts`, mapped in
      `EPIC-08-Portal.md` → Acceptance Criteria and `docs/05-modules/Portal.md`.
- [ ] 4.3 Create the `apps/web/src/app/(portal)/[slug]/**` pages for pets,
      detail, appointments, and booking; test required UI states and semantic
      tokens/no staff navigation. **Partial, recorded as a limitation rather
      than checked**: the four pages above are delivered and tested
      (`(portal)/[slug]/pets/**`, `/appointments/**`, `/pets/[id]/book/**`, PRs
      #43–#52), but the `profile` page named in this task was **not** created.
      There is no holder-facing profile page and no client function for it; the
      profile read/write exists only on the API (`GET|PUT /portal/profile`,
      `portal-profile.integration.test.ts`) and is forwardable by the proxy, and
      `PortalNav` links only home, pets and appointments. See
      `docs/05-modules/Portal.md` → "Known Limitations".

## Phase 5: Hardening and documentation (WU5)

WU5 is merged at `27bc04a` (merge of PR #53); CI evidence is recorded in
`docs/10-qa/CI-EVIDENCE.md` → "EPIC-08 Closure Baseline".

- [x] 5.1 Pin proxy and live-PG revocation, isolation, pending, and idempotency
      evidence in `apps/api/src/rbac/route-contract.probe.test.ts` and
      `apps/api/test/live-pg-isolation.e2e-spec.ts`. Evidence: PR #53
      (`f222816`) adds the "EPIC-08 WU5 portal write concurrency and isolation"
      block (one approval winner, one reschedule winner, one cancel winner,
      byte-equivalent foreign `404`, revoked-guardian `404`); the live-PG suite
      is **40/40 passed** at `27bc04a`.
- [x] 5.2 Record PRD §8 deviation, deferrals, classification, rollback, and both
      unresolved details without implementing either in
      `docs/07-decisions/DEC-*.md` and `docs/05-modules/Portal.md`. Evidence:
      [[DEC-008]] records the PRD §8 deviation, deferrals, classification,
      rollback and both resolved questions; [[DEC-007]] (merged, PR #39) settled
      the availability union, portal booking, and staff-assigned professional;
      `docs/05-modules/Portal.md` records the classification and merged-state
      limitations. [[DEC-008]] and `Portal.md` are part of the closure
      documentation set committed separately from this archive move.
- [x] 5.3 Root gates: lint, format-check, typecheck, test, build; plus
      `pnpm services:up && pnpm preflight` before verification. Evidence: both
      required CI jobs are `success` at `27bc04a` — the quality job (14/14 lint,
      14/14 typecheck, 15/15 test, 9/9 build) and the migrations job (live-PG
      40/40) — per `docs/10-qa/CI-EVIDENCE.md`.
