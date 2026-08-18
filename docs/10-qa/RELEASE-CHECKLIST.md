---
type: qa
status: active
updated: 2026-08-13
---

# Release Checklist

## Build

- [ ] Clean install succeeds.
- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Unit tests pass.
- [ ] Required integration tests pass.
- [ ] Build passes.
- [ ] Critical E2E tests pass.

## Security

- [ ] Tenant A cannot read Tenant B resources.
- [ ] Tenant A cannot modify Tenant B resources.
- [ ] Portal user cannot access staff endpoints.
- [ ] Staff missing permission is rejected.
- [ ] Sensitive secrets are absent from API responses/logs.
- [ ] Private attachment URLs expire.
- [ ] Tenant branding cannot expose arbitrary CSS/JS.
- [ ] Public branding DTO contains only allowlisted visual fields.
- [ ] Tenant A cannot edit Tenant B branding.
- [ ] Production stack traces are disabled.
- [ ] Rate limits are enabled where required.

## UI / Branding

- [ ] Shared components use semantic tokens instead of product-specific colors.
- [ ] Product preset can be changed without editing reusable components.
- [ ] Tenant branding overrides product defaults only for allowed properties.
- [ ] Logo/favicon fallback works when tenant assets are missing.
- [ ] Staff and portal resolve the expected tenant brand.
- [ ] Branding live preview does not persist until Save.

## Business invariants

- [ ] Reversal commands are idempotent where implemented.
- [ ] Reversals preserve original records and create compensating entries.
- [ ] Tenant settings reject unknown/invalid keys and are tenant isolated.
- [ ] Internal post-commit event handlers do not replace required transactional
      invariants.

- [ ] Closed ClinicalEncounter cannot be silently modified.
- [ ] Completed Sale cannot complete twice.
- [ ] Purchase cannot be received twice.
- [ ] Stock correction uses movements.
- [ ] Negative stock policy is enforced.
- [ ] Cash register cannot have invalid concurrent OPEN sessions.
- [ ] Cash session cannot close twice.
- [ ] Invoice cannot confirm twice.
- [ ] Fiscal issue is idempotent.

## Data handling

- [ ] No RESTRICTED secrets appear in application tables/logs unintentionally.
- [ ] No real production personal/clinical/fiscal data exists in demo/dev seed.
- [ ] Sensitive API responses use explicit DTO allowlists.
- [ ] Demo fiscal path cannot use production credentials.
- [ ] Demo seed is guarded against accidental production execution.

## Operations

- [ ] Environment variables validated.
- [ ] Database migrations reviewed.
- [ ] Backups enabled.
- [ ] Recovery procedure documented/tested at required cadence.
- [ ] Error tracking enabled.
- [ ] Health endpoints healthy.

## Documentation

- [ ] Changed Stories updated.
- [ ] Module docs match behavior.
- [ ] ADRs/Decisions recorded.
- [ ] Tech Debt recorded.
- [ ] Changelog updated.
