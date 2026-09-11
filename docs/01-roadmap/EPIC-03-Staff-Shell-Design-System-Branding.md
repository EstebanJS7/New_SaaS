---
id: EPIC-03
type: epic
title: Staff Shell, Design System and Branding
status: done
priority: high
depends_on:
  - EPIC-01
prd_sections:
  - "10.1"
created: 2026-08-13
updated: 2026-09-11
---

# EPIC-03 — Staff Shell, Design System and Branding

## Objective

Create the reusable application shell and design system so the same UI can
present different product presets and tenant branding without component forks.

## Scope

- Next.js staff shell;
- Tailwind/shadcn setup;
- semantic design tokens;
- light/dark/system appearance;
- `ProductBrandPreset`;
- `TenantBranding`;
- BrandProvider/resolver;
- safe logo/favicon asset handling;
- staff branding settings page;
- live preview;
- reset to product defaults;
- entitlement integration;
- tenant-safe branding API;
- safe public branding DTO;
- sidebar/topbar using resolved identity.

## Out of Scope

- arbitrary CSS editor;
- page builder;
- custom-domain/TLS automation;
- per-tenant component forks;
- advanced CMS.

## Acceptance Criteria

- [x] Shared components use semantic design tokens.
- [x] Veterinary product preset can be changed without editing shared
      components.
- [x] Tenant can upload allowed light/dark logos and favicon when entitled.
- [x] Tenant can change approved theme properties.
- [x] Theme input is schema validated.
- [x] Arbitrary CSS/JS cannot be injected.
- [x] Staff and portal can consume the same ResolvedBrand contract.
- [x] Missing tenant overrides fall back to product preset.
- [x] Reset restores product defaults.
- [x] Public branding endpoint exposes only safe fields.
- [x] Tenant A cannot edit Tenant B branding.
- [x] Branding changes are audited.
- [x] Live preview does not persist until Save.
- [x] Lint/typecheck/tests/build are green.

Closure note (2026-09-11): Closed `done` on evidence-based closure against
canonical CI run `34605178149` at `c9cff613`. Phase A shipped the token layer,
the schema-valid veterinary preset, the resolver/CSS bridge, a chrome-only staff
shell, and client-local `light`/`dark` appearance persistence. Phase B shipped
tenant branding persistence, the private management API, public safe DTO,
server-side resolution, staff settings UI with bounded live preview, and audit
co-commit. DEC-004 Phase C shipped the tenant-owned `BrandingAsset` lifecycle
(strict MIME/size validation, signed-URL delivery, audit co-commit), anonymous
public asset delivery, and `system` appearance precedence. The branding
commit-readiness remediation made reset storage retirement durable
(transactional `PENDING` cleanup intent, bounded worker retries, terminal
failure audit, and an interval reconciliation sweep) and reconciled this record
and [[TD-009 Branding scope deferred]] with the accepted [[DEC-005]] /
[[ADR-004 Tenant Lifecycle Status]]: the public branding lookup now filters
`TenantStatus = ACTIVE`, so a `SUSPENDED` slug returns the identical
`404 NOT_FOUND` envelope as an unknown slug. The DEC-004 delivery is committed
on `main` in the range `b992053..c9cff61` (head `c9cff613`).
[[TD-009 Branding scope deferred]] remains **open** only for the deferred virus
scanning and the reset-cleanup dead-letter alerting/retention gap. Playwright
E2E remains deferred in [[TD-007 Playwright E2E deferred]] and live cross-tab
appearance sync in [[TD-008 Cross-tab appearance sync deferred]]. Closure is
epic implementation closure only, not production readiness: [[EPIC-20]]
Production Hardening and the open debt above remain.

Closure evidence (2026-09-11 fresh verification, Engram verify-report #2144):
all five root gates exited 0 on candidate `2a637cfd…`
(`evidence_revision sha256:9eb9ef6e…`; verdict `pass_with_warnings`, 0 blockers,
10/10 requirements, 16/16 scenarios) — `pnpm lint`, `pnpm format-check`,
`pnpm typecheck`, `pnpm test` (API 359 passed | 5 skipped; web 91; worker 27;
database 85; shared 16), and `pnpm build`. The pre-correction failing gate was
`pnpm format-check` (six unformatted files), now formatted. This documentation
correction's own root-gate verification also completed on 2026-09-11 (Engram
verify-report #2170, verdict `pass`): all five root gates exited 0 on candidate
`sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e` (0
blockers, 6/6 requirements, 8/8 scenarios); the "Lint/typecheck/tests/build are
green" criterion reflects the verified 2026-09-11 candidate.

## Criterion-to-evidence map

| Acceptance criterion group                                                                         | Evidence                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Semantic tokens; product preset without component forks; fallback chain; versioned schemas         | `openspec/archive/2026-08-24-epic-03-staff-shell-branding/specs/brand-tokens-and-presets/spec.md`; `docs/05-modules/Branding.md` |
| Staff shell; chrome-only navigation; appearance switch; bounded content region                     | `openspec/archive/2026-08-24-epic-03-staff-shell-branding/specs/staff-shell/spec.md`                                             |
| Tenant-scoped persistence; authorized management; audit/isolation; public safe DTO; preview        | `openspec/changes/2026-08-26-epic-03-branding-phase-b/specs/tenant-branding/spec.md`                                             |
| Asset lifecycle, isolation, authorization/entitlement, validation, signed URLs, reset retirement   | `openspec/changes/2026-09-08-dec-004-branding-expansion/specs/tenant-branding-assets/spec.md`                                    |
| Portal brand resolution, slug scoping, staff/portal separation, cache invalidation                 | `openspec/changes/2026-09-08-dec-004-branding-expansion/specs/portal-brand-resolution/spec.md`                                   |
| `system` appearance precedence, pre-paint bootstrap, OS-change handling, storage-failure tolerance | `openspec/changes/2026-09-08-dec-004-branding-expansion/specs/system-appearance/spec.md`                                         |
| Lint/typecheck/tests/build green                                                                   | CI run `34605178149` at `c9cff613`; Engram verify reports #2144 (candidate `2a637cfd…`) and #2170 (candidate `d7aaf517…`)        |

## Exit Criteria

- [x] Lint/typecheck/tests/build required for the Epic are green. — CI run
      `34605178149` at `c9cff613`: lint 14/14, format-check, typecheck 14/14,
      test 15/15 (640 passed / 6 skipped), build 9/9; verified earlier on
      candidates `2a637cfd…` (#2144) and `d7aaf517…` (#2170).
- [x] Cross-tenant isolation suite executes in a CI run. — CI run `34605178149`,
      `Database migrations` job: live-PG suite 6/6 passed, including the
      tenant-relative branding mutation isolation path.
- [x] Documentation is current. — `docs/05-modules/Branding.md`, this Epic,
      [[TD-009]], `docs/01-roadmap/ROADMAP.md`, and
      `docs/09-releases/CHANGELOG.md` reconciled 2026-09-11.

## Suggested Stories

```text
BRAND-001 Semantic design tokens
BRAND-002 Product brand preset
BRAND-003 Tenant branding persistence/API
BRAND-004 Branding asset upload
BRAND-005 Branding settings + live preview
BRAND-006 Public brand resolution / portal integration
```

## Related

- [[Branding and Theming]]
- [[ADR-002 Branding Theme Layering]]
