# Tasks: EPIC-06 Comprehensive Clinical Records

Traceability: clinical-management spec requirements map to WU1 (data/seed), WU2A
(encounter lifecycle, audit, tenancy), WU2B (specialized records), WU3
(authorization/API), WU4A (staff proxy + API client), WU4B (staff workspace UI),
and WU5 (verification/docs); design §§3-10 define the implementation seams.

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review budget           | 800 changed lines per slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Estimated changed lines | WU2A 827 impl / 1,533 incl. tests (delivered); WU2B 844 impl + 20 module lines / 1,235 changed incl. 371 tests (delivered 2026-09-12; maintainer-approved `size:exception`); WU3 570 contract/source + 760 tests = 1,330 changed incl. tests (review corrections applied 2026-09-12; maintainer-approved `size:exception`); WU4A 743 changed incl. tests (proxy + client; re-sliced 2026-09-12) then **1,141 changed incl. tests after the 2026-09-12 security/error correction pass** (+398; now over the ≤800 budget — `size:exception` approved by the maintainer after the 2026-09-12 fresh re-review, no test/comment minified); WU4B **1,384 changed code lines (668 workspace + 656 workspace RTL + 58 parent PatientDetail RTL + 2 mount) after the 2026-09-12 conflict-reload/evidence correction pass and the final parent PatientDetail UUID fixture correction** (debounced autosave, permission-aware mutations, conflict-reload autosave suspension, accessibility, delayed-refetch regression + unmount/in-flight tests, plus the parent `patient-detail.test.tsx` fixture migration to canonical UUIDs with an assertion that the mounted clinical workspace never renders the `INVALID_IDENTIFIER` state) plus SDD-artifact deltas; the reviewed measure including SDD docs was **~1,520 changed lines, over the ≤800 budget, and the maintainer approved the WU4B `size:exception`** (implemented and verified; no test/comment minified) |
| Delivery strategy       | force-chained (feature-branch-chain)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Suggested split         | WU1 → WU2A → WU2B → WU3 → WU4A → WU4B → WU5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Decision needed before apply: No Chained PRs recommended: Yes Chain strategy:
feature-branch-chain 400-line budget risk: High

Re-slice note (2026-09-12): the original WU2 ("Clinical Service Core") mixed the
encounter lifecycle with the five specialized record kinds in one 2,104-line
uncommitted slice. The maintainer rejected a `size:exception` and required a
split for maintainability and CI diagnosis; WU2 is therefore re-sliced into
**WU2A Encounter Core** and **WU2B Specialized Records** without changing
approved product scope.

Slice boundary (corrected 2026-09-12, review findings 1 and 4): **WU2A is
complete and merged into the tracker** (`feat/epic-06-clinical` @ `11d144c`, PR
#6). **WU2B is now implemented on its own branch**
(`feat/epic-06-clinical-wu2b-specialized-records`, based on the latest tracker)
and is now **committed after a fresh review approved it**. Within the **WU2A
commit**, `clinical.module.ts` wires only `ClinicalService` and does not
reference WU2B's `ClinicalRecordsService`; WU2A typechecks, builds, and tests
independently with the WU2B files absent (verified during WU2A finalization).
WU2B's own branch adds the `ClinicalRecordsService` provider/export without
changing the encounter core. A strict ≤800 total including tests is infeasible
without deleting tests or comments, which the workload guard forbids; the
measure is reported per part and WU2A's `size:exception` is maintainer-approved.
WU2B's measured 1,235 changed lines also exceed the ≤800 slice budget; after
fresh review the maintainer approved a **WU2B `size:exception`** for the honest,
non-minified measure, so WU2B is committed as its own chained commit.

WU3 progress note (2026-09-12): WU2B merged into the tracker (`75cb822`, PR #7).
**WU3 is implemented on `feat/epic-06-clinical-wu3-api-contracts` but NOT
committed** — a fresh review rejected the first cut and required three
corrections, now applied: (1) byte-equivalent cross-tenant 404 + no-write proof
for foreign clinical **aggregate UUIDs** (encounter GET + the five record update
routes) using foreign record ids rather than only a foreign Patient anchor; (2)
a permission-to-route mapping fence (exact `vet.clinical.*` key per route via
the route-contract probe) plus a single-key runtime enforcement matrix; and (3)
truthful size-exception documentation. **The maintainer has approved the WU3
`size:exception`** (recorded 2026-09-12). Post-correction measured size is 570
changed lines of API contract/source support (147 zod + 103 encounters
controller + 230 records controller + 82 route-probe + 8 module) plus 760
changed test lines (618 HTTP integration + 142 fixture) = **1,330 changed lines
(1,328 additions / 2 deletions) incl. tests**, over the ≤800 slice budget; no
comment or test was minified. A further fresh review is required before WU3 is
committed.

## Work Units

| Unit | Scope and PR base guidance                                                                                                                                                                                                    | Focused test command                   | Runtime harness                   | Rollback boundary                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| WU1  | Schema, migration, permissions, seeds; base is the tracker/main base                                                                                                                                                          | `pnpm test --filter @newsaas/database` | DB migration/test harness         | Revert code; retain additive clinical data           |
| WU2A | Encounter core (`ClinicalServiceBase` + `ClinicalService`): create/list/get, versioned autosave, close, linked amendments, tenancy, entitlement/permissions, client-safe DTO, module registration, tests; base is WU1/tracker | `pnpm test --filter @newsaas/api`      | API fake-Prisma unit harness      | Remove module registration only after WU3            |
| WU2B | Specialized records (`ClinicalRecordsService`): treatments, vaccinations, deworming, studies, weights CRUD + tests; base is the WU2A branch                                                                                   | `pnpm test --filter @newsaas/api`      | API fake-Prisma unit harness      | Remove subdomain service/export; keep encounter core |
| WU3  | Controllers, Zod, DTOs, route contract; base is the WU2B branch                                                                                                                                                               | `pnpm test --filter @newsaas/api`      | API integration/probe harness     | Remove API exposure; keep immutable records          |
| WU4A | Staff clinical proxy + API client (`/api/clinical` proxy + `clinical-api.ts`) and their node tests; base is the WU3/tracker branch                                                                                            | `pnpm test --filter @newsaas/web`      | Node/web unit harness             | Remove proxy + client; keep API                      |
| WU4B | Staff clinical workspace UI (`clinical-workspace.tsx` + RTL tests) and the `patient-detail.tsx` mount; base is the WU4A branch                                                                                                | `pnpm test --filter @newsaas/web`      | RTL web harness                   | Remove workspace component/mount                     |
| WU5  | Live-PG evidence and documentation; base is the WU4B branch                                                                                                                                                                   | `pnpm test --filter @newsaas/api`      | Live PostgreSQL isolation harness | Revert verification/docs only                        |

## Phase 1: Data Foundation

- [x] 1.1 RED: add `packages/database/src/schema-clinical.test.ts` for six
      models, enum, RESTRICT FKs, indexes, Decimal weight, and
      CLOSED-update/DELETE trigger (spec Clinical subdomain records; design
      §§3,6).
- [x] 1.2 GREEN: update `packages/database/prisma/schema.prisma`; create
      additive `packages/database/prisma/migrations/<ts>_clinical/migration.sql`
      with the guarded immutability trigger.
- [x] 1.3 RED then GREEN: extend `reference-seed` and `demo-seed`
      tests/implementations for all clinical permissions, role matrix,
      idempotent synthetic no-PII encounter and record (spec Synthetic demo
      data; design §3).

## Phase 2A: Encounter Core (WU2A)

- [x] 2A.1 RED: create `apps/api/src/clinical/clinical.service.test.ts` (repo
      runner uses `*.test.ts`) for version/stale 409, CLOSED 409, one
      transactional audit, amendment reason/permission/idempotency, entitlement,
      cross-tenant 404, allowlisted projection and client-safe `internalNotes`
      exclusion before the service (spec Lifecycle, Autosave, Amendments, Audit,
      Isolation).
- [x] 2A.2 GREEN: create `apps/api/src/clinical/clinical.service.base.ts`
      (shared tenant/entitlement/permission/audit boundary),
      `clinical.service.ts` (encounter lifecycle with conditional
      `updateMany(status=DRAFT, version=N)`; concurrency-safe amendment:
      `SELECT ... FOR UPDATE` on the original inside the transaction, in-tx
      idempotency replay, and exact-target `P2002` unique-conflict recovery
      scoped to `clinical_encounter_tenant_id_idempotency_key_key`),
      `clinical.dto.ts` (encounter allowlist + `toClientSafeEncounter`) and
      `clinical.module.ts`; register `ClinicalModule` in
      `apps/api/src/app.module.ts`. `clinical.module.ts` provides/exports ONLY
      `ClinicalService` — it does not reference WU2B's `ClinicalRecordsService`.

## Phase 2B: Specialized Records (WU2B)

> **Implemented on `feat/epic-06-clinical-wu2b-specialized-records`** (base:
> tracker `feat/epic-06-clinical` @ `11d144c`, which already contains WU2A). The
> WU2A commit contains none of these files; on the WU2B branch
> `clinical.module.ts` provides/exports `ClinicalRecordsService` on top of the
> unchanged encounter core. Fresh-context review approved the slice (no
> blockers) and the maintainer approved the 1,235-line `size:exception`; WU2B is
> committed as its own chained commit on that branch.

- [x] 2B.1 RED: create `apps/api/src/clinical/clinical.records.service.test.ts`
      covering the five subdomain record kinds, tenant-scoped
      create/list/update, exactly-one co-committed audit, and invalid-weight
      rejection (spec Clinical subdomain records, Transactional audit, Tenant
      isolation). **7 tests**, all green (treatment, vaccination, deworming,
      study, weight, invalid-weight persistence guard, cross-tenant 404).
- [x] 2B.2 GREEN: create `apps/api/src/clinical/clinical.records.service.ts`
      (`ClinicalRecordsService` extending `ClinicalServiceBase`) and
      `clinical.records.dto.ts` for treatment/vaccination/deworming/study/weight
      create/list/update; add the `ClinicalRecordsService` provider/export to
      `clinical.module.ts` without changing the WU2A encounter core. Wired and
      verified: typecheck, lint, build and the full API suite are green.

## Phase 3: API Contracts

- [x] 3.1 RED: add route/probe tests for all nested encounter and five subdomain
      routes, 403 permissions/entitlement, 400 invalid weight, 404 tenant
      misses, and no leaked `internalNotes` client projection (spec
      Authorization, Confidential API). **Implemented** as
      `apps/api/src/clinical/clinical.http.integration.test.ts` (10 tests) over
      the real guard chain plus the `clinical-http-fixture.ts` boundary, and the
      pinned route inventory in `route-contract.probe.test.ts`. Focused run: 4
      files / 50 tests passed.
- [x] 3.2 GREEN: add clinical controllers, Zod inputs, DTOs, permission
      declarations, and `apps/api/src/rbac/route-contract.probe.test.ts`
      inventory (design §4). **Implemented** as
      `clinical.encounters.controller.ts`, `clinical.records.controller.ts`,
      `clinical.zod.ts` and the `ClinicalModule` controller registration;
      services/DTOs/permissions unchanged. Full API suite green (52 files / 476
      passed, 16 live-PG skipped); typecheck, lint, build and prettier clean.

## Phase 4A: Staff Proxy and API Client (WU4A)

- [x] 4A.1 RED: add node tests for the authenticated `/api/clinical` proxy
      (cookie/`x-request-id` allowlist, Patient-anchored path rewrite,
      raw-stream mutating body with `duplex: "half"`, streamed response, 409
      passthrough) and the `clinical-api.ts` client contract (proxy paths, body
      shapes, stable error code/status, conflict classification, client-safe
      `internalNotes` stripping). **Implemented** as
      `apps/web/src/app/api/clinical/[[...path]]/route.test.ts` and
      `apps/web/src/app/(app)/app/patients/[id]/clinical-api.test.ts`.
- [x] 4A.2 GREEN: create `apps/web/src/app/api/clinical/[[...path]]/route.ts`
      and `apps/web/src/app/(app)/app/patients/[id]/clinical-api.ts`.
      Independently build/testable: with the WU4B workspace files moved aside,
      typecheck/lint/build pass and the focused plus full web suites are green —
      see the WU4A evidence in `apply-progress.md`.
- [x] 4A.3 Security/error correction pass (2026-09-12, maintainer-authorized):
      the proxy now rejects empty/malformed Patient anchors, traversal and
      encoded-separator segments, unknown route shapes and non-contract methods
      via an allowlisted set of clinical route shapes with re-encoded upstream
      construction (`/api/clinical` no longer maps to an unanchored
      `/clinical`); the client validates and encodes UUID identifiers before
      path construction; and error parsing normalizes
      invalid/`null`/non-envelope JSON and rejected fetches into stable
      `ApiRequestError` codes (`UNKNOWN`, `NETWORK_ERROR`, `MALFORMED_RESPONSE`,
      `INVALID_IDENTIFIER`) instead of a runtime `TypeError`. Focused WU4A is
      now 2 files / **34 tests** (route 15, client 19). WU4A measured size is
      now **1,141 changed lines**, over the ≤800 slice budget; the maintainer
      approved the `size:exception` after the 2026-09-12 fresh re-review (no
      test or comment minified). The tightened client contract requires the WU4B
      fixtures to move to UUID ids in its own chained slice.

## Phase 4B: Staff Workspace UI (WU4B)

> **Re-slice note (2026-09-12)**: the original WU4 ("Staff proxy and patient
> workspace") was a single 1,526-line uncommitted slice. The maintainer rejected
> a `size:exception` and required a split for maintainability and CI diagnosis;
> WU4 is re-sliced into **WU4A Clinical Proxy & Client** (743 changed lines) and
> **WU4B Staff Workspace UI** (783 planned, 795 measured before corrections,
> 1,326 measured after the 2026-09-12 conflict-reload/evidence correction pass,
> 1,384 after the final parent PatientDetail UUID fixture correction) without
> changing approved product scope. WU4A is complete and merged into the tracker
> (`7128cf7`). WU4B is implemented and verified on
> `feat/epic-06-clinical-wu4b-workspace-ui`, including the UUID fixture
> migration required by the WU4A client contract, the 2026-09-12
> maintainer-authorized review-correction pass (task 4B.3), the
> conflict-reload/evidence correction pass (task 4B.4) and the final parent
> PatientDetail UUID fixture correction (task 4B.5). The maintainer approved the
> WU4B **`size:exception`** for the honest, non-minified measure (~1,520 changed
> lines including SDD docs at review; larger after the authorized corrections).

- [x] 4B.1 RED: add RTL tests for loading, empty, error, success, denied,
      autosave conflict, close, amendment, and client-safe `internalNotes`
      separation (spec Staff workspace). Implemented as
      `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx` (11
      tests). The WU4A client validates UUID identifiers, so the fixtures were
      migrated from `patient-1`/`enc-1` to canonical UUIDs; the focused suite is
      green (11 passed) and the full web suite is green (26 files / 162 passed).
- [x] 4B.2 GREEN: implement `clinical-workspace.tsx` and the
      `patient-detail.tsx` mount using semantic tokens and the authenticated
      proxy only. The implementation and verification are complete; the commit
      is intentionally deferred by maintainer instruction and remains gated on
      the mandatory fresh review, so no commit/push/PR/merge was performed.
- [x] 4B.3 Review-correction pass (2026-09-12, maintainer-authorized): (1) the
      draft save is now a debounced on-change versioned autosave with
      dirty-gating, timer cleanup on every change/unmount, an in-flight
      no-clobber guard, and a state-aware mock exercising the real timer; (2)
      mutation `403 FORBIDDEN` / `FEATURE_NOT_ENTITLED` render as neutral
      permission-aware UX (`PermissionDeniedAlert`) and disable the unavailable
      create/save/close/amend affordances with no retry loop; (3) "Reload
      latest" clears the conflict together with the stale mutation error,
      preserving the local draft; (4) success notices/autosave status use a
      `role="status"` live region and the selected encounter exposes
      `aria-current="true"`. Focused WU4B became **20 tests** (was 11) and WU4B
      measured **1,150 changed code lines** (632 workspace + 516 RTL + 2 mount);
      including the SDD docs this exceeded the ≤800 budget, which the maintainer
      covered with the WU4B `size:exception`.
- [x] 4B.4 Conflict-reload/evidence correction pass (2026-09-12,
      maintainer-authorized): (1) autosave is suspended across the entire
      conflict-reload lifecycle until the refetch resolves and the refreshed
      authoritative encounter version is adopted, so no stale-version write can
      fire before/during a delayed refetch; (2) editor fields stay editable
      while a save is in flight so the in-flight no-clobber guard is reachable;
      (3) focused tests added for a delayed conflict reload, unmount timer
      cancellation, and an in-flight save that must not clobber a newer local
      edit (focused WU4B is now **23 tests**, was 20); (4) WU4B size/accounting
      corrected to **1,326 changed code lines** (668 workspace + 656 RTL + 2
      mount) measured after this pass, with the maintainer-approved WU4B
      `size:exception` in force. All gates green (focused 23/23, full web
      174/174, typecheck/lint/build/prettier).
- [x] 4B.5 Parent PatientDetail UUID fixture correction (2026-09-13,
      maintainer-authorized final correction): migrate
      `apps/web/src/app/(app)/app/patients/[id]/patient-detail.test.tsx` from
      the invalid `patient-1` placeholders to the canonical UUID
      `11111111-1111-4111-8111-111111111111` (one `vi.hoisted` constant consumed
      by the `useParams` mock, the `PATIENT`/guardian fixtures, and every URL
      matcher/assertion, so the fixture set cannot drift), and add a test
      asserting that mounting `PatientDetail` lets the clinical client accept
      the patient id (the encounter list request reaches the proxy and settles
      on the stubbed API error) instead of rendering the clinical
      `INVALID_IDENTIFIER` ("Invalid patient id.") state. Measured **58 changed
      lines** (46 insertions / 12 deletions); the WU4B cumulative code measure
      is now **1,384 changed code lines** (668 workspace + 656 workspace RTL +
      58 parent RTL + 2 mount). All gates green (focused parent+WU4B 33/33; full
      clinical slice 85/85; full web 175/175; typecheck/lint/build/prettier).
      RED proof (one-variable, reverted): setting the constant value back to
      `patient-1` made only the new test fail — the mount rendered "Invalid
      patient id." — then the UUID value was restored byte-for-byte (sha256
      `85f25859…`).

WU4A/WU4B re-slice note (2026-09-12): **WU4A is implemented on
`feat/epic-06-clinical-wu4a-proxy-client`** (renamed from
`feat/epic-06-clinical-wu4-staff-workspace`; base: tracker
`feat/epic-06-clinical` @ `eb7b838`, which contains WU1 + WU2A + WU2B + WU3).
WU4A ships the authenticated `/api/clinical` proxy and the `clinical-api.ts`
client with their node tests and no workspace UI. WU4B holds the
`clinical-workspace.tsx` workspace (loading/empty/error/success/denied,
version-guarded draft save with 409 conflict handling, close, amend, client-safe
`internalNotes` separation), its RTL tests, and the `patient-detail.tsx` mount;
those files remain uncommitted/untracked. Semantic tokens only; Portal is
untouched. WU4A measured size was **743 changed lines** (314 implementation +
429 tests) before the security/error correction pass and is now **1,141 changed
lines** (474 implementation + 667 tests) after it; that exceeds the ≤800 slice
budget, so the maintainer approved a **WU4A `size:exception`** after the
2026-09-12 fresh re-review (no test or comment was minified). WU4B measured
**795 changed lines** (491 workspace + 302 RTL tests + 2-line mount) **before**
the 2026-09-12 review-correction passes and now measures **1,384 changed code
lines** (668 workspace + 656 workspace RTL tests + 58 parent PatientDetail RTL +
2-line mount) after the conflict-reload/evidence correction pass and the final
parent PatientDetail UUID fixture correction. Because the WU4A correction
tightened the client to UUID identifiers, the WU4B RTL fixtures were migrated
from `patient-1` / `enc-1` to canonical UUIDs (including the parent
`patient-detail.test.tsx` fixtures, task 4B.5), and the suite is now green.
Fresh re-review APPROVED WU4A and its 1,141-line `size:exception` on 2026-09-12;
WU4A is committed as exactly one chained commit
`feat(EPIC-06): add clinical proxy and client`. WU4B is implemented and verified
on `feat/epic-06-clinical-wu4b-workspace-ui` (base: tracker
`feat/epic-06-clinical` @ `7128cf7`); the maintainer approved the WU4B
**`size:exception`** for the honest, non-minified measure (~1,520 changed lines
including SDD docs at review; larger after the authorized corrections).

## Phase 5: Evidence and Documentation

- [ ] 5.1 RED then GREEN: extend `apps/api/test/live-pg-isolation.e2e-spec.ts`
      for byte-equivalent cross-tenant 404 and parallel autosaves yielding one
      409; threat matrix cases are N/A per design §8.
- [ ] 5.2 Run root gates, record migration/routes/tests and open questions in
      the change documentation; do not resolve design §10 scope questions
      without a decision.
