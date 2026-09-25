# Archive Report: EPIC-08 — Portal

**Archived**: 2026-09-21 **Mode**: hybrid (OpenSpec filesystem + Engram)
**Change**: epic-08 **Verdict**: pass_with_warnings (0 CRITICAL, 0 blockers)
**Merge**: `27bc04a` (merge of PR #53, `feat/epic-08-wu5-live-pg-evidence`)

> **Historical snapshot (2026-09-21).** The limitations and contents below
> describe the archive at merge `27bc04a`, not the current product. Later PRs
> added the profile page (#55), corrected error copy (#60), resolved species and
> breed names (#61), and enabled contact-detail removal (#62). For current
> behavior see `docs/01-roadmap/EPIC-08-Portal.md` and
> `docs/05-modules/Portal.md`. `wu4-delivery-trace.md` was added afterward to
> preserve slice-level history; it is not part of the original archive-contents
> checklist below.

## Summary

EPIC-08 delivered a first-party, Customer-linked customer portal as a separate
security boundary from staff: its own credential, `PortalSession`,
`ns_portal_session` cookie and `PortalAuthGuard`; staff-provisioned access with
one active holder per Customer and per login email; holder-owned reads (pets,
allowlisted `clientSummary` + vaccinations, appointments, booking requests,
profile); availability as a union across every in-tenant `VETERINARIAN`; booking
requests that stay pending until a staff approval promotes exactly one `PORTAL`
appointment; phone/address self-service; and a portal-only web surface and
proxy. Invoices/documents (EPIC-14/§25), email invitation/recovery and
notifications (EPIC-17), shared caregiver access, service selection (EPIC-09)
and automatic booking confirmation were explicitly deferred. The PRD §8
deviation (first-party instead of external managed auth) is recorded in DEC-008.

The change shipped as a chained feature-branch sequence (WU1 → WU5) and merged
to `main` through the PR chain #19–#53. This archive move is the closure step
the epic's own Exit Criteria recorded as a separate slice; the plan artifacts
existed only in the working directory and were not yet versioned.

## Delivery Evidence Verified

| Slice | Scope                    | Merged evidence                                                                             |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------- |
| WU1   | Data/settings            | PRs #19–#20; schema/migration, PORTAL audit actor, seeds, typed `portal` namespace          |
| WU2   | Identity/boundary        | PRs #21–#25; credential/session, guard fence, provisioning/revocation, isolation            |
| WU3   | Read surface + web proxy | PRs #26–#28 (`d6a8c78`, `df9a592`, `3e42f90`)                                               |
| WU4   | Booking, profile, UI     | PRs #29–#52; booking/approval, availability, profile, cancel/reschedule, portal pages       |
| WU5   | Hardening, gates, docs   | PR #53 (`f222816`); live-PG write-race evidence, root gates, DEC-007/DEC-008 and module doc |

Epic-level evidence is the immutable CI baseline at `27bc04a`
(`docs/10-qa/CI-EVIDENCE.md` → "EPIC-08 Closure Baseline"): both required jobs
`success`, live-PG suite **40/40 passed**, and `pnpm lint` / `pnpm format-check`
/ `pnpm typecheck` / `pnpm test` / `pnpm build` green. The archived
`verify-report.md` is the WU1 re-verification (`pass_with_warnings`, 0 blockers,
3/3 requirements, 4/4 scenarios); WU2–WU5 acceptance is mapped in
`docs/01-roadmap/EPIC-08-Portal.md` and `docs/05-modules/Portal.md`.

## Specs Synced

| Domain            | Action  | Details                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| portal-management | Created | 14 requirements, 35 scenarios — new full spec (no prior main spec). Copied byte-identically from the delta.                                                                                                                                                                                                                      |
| scheduling        | Updated | ADDED "Portal-originated booking requests" (5 scenarios); MODIFIED "Granular authorization" (+1 "Approval requires the manage permission" scenario); ADDED "Free-slot availability read" (5 scenarios) — see the reconciliation note below; `Purpose` exclusion list narrowed so it no longer excludes the Portal approval path. |
| tenant-settings   | Updated | 2 MODIFIED: "Typed code registry with schema versions" (three v1 namespaces incl. `portal`; +2 scenarios), "Authenticated reads, permission-gated writes" (adds `portal.settings.manage`; +1 scenario). 3 requirements preserved unchanged.                                                                                      |

Standing specs after the merge: `openspec/specs/portal-management/spec.md` (14
requirements, 35 scenarios), `openspec/specs/scheduling/spec.md` (11
requirements, 30 scenarios), `openspec/specs/tenant-settings/spec.md` (5
requirements, 17 scenarios).

### Reconciliation note: the `scheduling` "Free-slot availability read" delta

The `scheduling` delta declared **two** requirements under `## MODIFIED`, but
"Free-slot availability read" had no counterpart in the standing
`openspec/specs/scheduling/spec.md` (nor in the EPIC-07 archive). It is in fact
an addition delivered during EPIC-08 (commit `59314fa`, "feat(scheduling): read
the free slots for a professional"). It was merged as a **new** requirement
rather than silently dropped, and the pre-existing "Portal booking/approval"
exclusion in that spec's `Purpose` was narrowed to avoid contradicting the new
`portal-management` ownership. No standing requirement was duplicated.

## Reconciliation of Stale Claims

Independent verification found four stale claims in the plan artifacts. Each is
corrected in the archived copies, backed by merged code/commits or the epic's
own records; nothing unmerged was marked complete.

1. **`tasks.md` phase 4 (4.1–4.2) and phase 5 (5.1–5.3) unchecked although WU4
   and WU5 are merged.** Now checked. Evidence: PRs #29–#52 (WU4) and PR #53
   (`f222816`, WU5); live-PG 40/40 and both required CI jobs `success` at
   `27bc04a`; the acceptance map in `docs/01-roadmap/EPIC-08-Portal.md` and the
   merged portal/booking test files.
2. **`apply-progress.md` said WU4 and WU5 "remain pending and were not
   started".** The final `Status` paragraph now records the merged state and
   points to a new "Reconciled WU4/WU5 Closure" section; the earlier WU1-batch
   snapshots are retained as the chronological apply log and explicitly labelled
   historical.
3. **`design.md` listed two Open Questions as open.** Both are resolved by the
   merged code and DEC-008: the login id is the staff-managed `contactEmail`
   (matched case-insensitively, backed by the partial unique index on
   `(tenant_id, lower(contact_email)) WHERE status = 'ACTIVE'`; no username
   column); the professional is staff-assigned at approval per DEC-007, with the
   booking request body carrying neither branch nor professional. The section is
   now `Resolved Questions`, checked, in the archived `design.md`.
4. **`tasks.md` 4.3 named a profile page among the pages to create.** No
   holder-facing profile page or client function exists. 4.3 is left
   **unchecked** and records the limitation: the profile read/write exists only
   on the API (`GET|PUT /portal/profile`, `portal-profile.integration.test.ts`)
   and is forwardable by the proxy, while `PortalNav` links only home, pets and
   appointments. The four real pages (pets, pet detail, appointments, booking)
   are stated as delivered. This matches `docs/05-modules/Portal.md` → "Known
   Limitations".

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `design.md` ✅ (Open Questions reconciled to resolved)
- `tasks.md` ✅ (4.1–4.2, 5.1–5.3 checked; 4.3 explicitly left unchecked as a
  documented limitation)
- `apply-progress.md` ✅ (WU4/WU5 closure reconciled)
- `verify-report.md` ✅ (WU1 re-verification, pass_with_warnings)
- `specs/` ✅ (portal-management, scheduling, tenant-settings)
- `archive-report.md` ✅ (this file)

## Source of Truth Updated

The following main specs now reflect the new behavior:

- `openspec/specs/portal-management/spec.md` — created (full spec)
- `openspec/specs/scheduling/spec.md` — merged 1 added, 1 modified, and 1
  mis-declared modified requirement
- `openspec/specs/tenant-settings/spec.md` — merged 2 modified requirements

## Archive Structure Verification (pre-commit state)

- [x] Main specs updated — `portal-management` created; `scheduling` and
      `tenant-settings` merged from the change deltas with no duplicates
- [x] Change folder moved — `openspec/changes/archive/2026-09-21-epic-08/`
- [x] Archive contains all artifacts — proposal.md, exploration.md, design.md,
      tasks.md, apply-progress.md, verify-report.md, specs/, archive-report.md
- [x] Old change path `openspec/changes/epic-08/` no longer exists; the
      previously tracked `specs/scheduling/spec.md` moved with the folder
- [x] Reconciled artifacts are Prettier-clean (`pnpm format-check`, exit 0)
- [x] No commit, push, branch or PR performed by this step

## Warnings

1. **`verify-report.md` is WU1-scoped.** It resolves the WU1 candidate
   traceability question only; WU2–WU5 verification is the merged CI/live-PG
   evidence at `27bc04a`, not a single epic-level verify report.
2. **Recorded merged-state limitations (not defects introduced here).** No
   holder-facing profile page or client function; `bookingRequiresApproval` is
   registered but not consumed by the booking flow; species/breed names are
   unresolved without a holder-facing catalog read; `INTERNAL` `DomainError`
   messages are echoed to the client. All are documented in
   `docs/05-modules/Portal.md` and `docs/10-qa/CI-EVIDENCE.md`.
3. **Closure documentation is committed separately.**
   `docs/01-roadmap/EPIC-08-Portal.md`, `docs/05-modules/Portal.md`,
   `docs/07-decisions/DEC-008-first-party-portal-identity.md` and
   `docs/08-tech-debt/TD-012-*` are part of the epic's closure documentation set
   and are committed outside this archive move.

## Next Recommendation

none — SDD cycle complete. The EPIC-08 archive move was the last outstanding
closure slice.
