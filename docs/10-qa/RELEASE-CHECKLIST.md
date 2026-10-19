---
type: qa
status: active
updated: 2026-08-13
---

# Release Checklist

## The surface smoke pass (2026-10-19)

Run after [[SHELL-001]] and [[PORTAL-002]] made both identities signable,
because the app had by then never been driven as a whole — and the biggest gap
of the session (no page established a session) was found by LOOKING rather than
by any test.

**Two halves, and they prove different things.**

The **fence** is `apps/web/src/app/surface-integrity.test.ts`: it walks the
app's own route tree and asserts that every page is reachable from some link,
and that every link resolves to a page. It reads SOURCE, so it runs in CI with
no infrastructure — and that is also its limit: it proves reachability in the
code, not that a page renders or that a form submits.

The **live pass** ran the whole stack (PostgreSQL 16, Redis, the built API,
`next start`) with a staff session and a portal session:

```text
the staff, 18 routes + 2 detail routes        all 200 with a session
the portal, 4 public routes                   all 200 without a cookie
the portal, 5 protected routes                all 200 with a portal session
the gate                                     /demo/pets and /demo/profile -> 307 -> /demo/login
the nav's 12 rendered hrefs                   all 200
```

**What it found, and both are fixed:**

1. **`/app/settings/branding` was an orphan.** The whole branding settings
   surface existed and nothing linked to it — the same class as the missing
   login page, one level down. It is now in the shell's nav.
2. **`/app/placeholder` was a test-only route.** It existed to prove that a
   sub-route keeps the shell, and it shipped to production reachable by URL.
   Deleted; the layout's own case renders a synthetic child, because the
   property belongs to the layout.

**What this pass does NOT prove**, stated rather than implied: no browser was
involved. A page that renders and whose form does not submit would pass every
check here, and so would a button that does nothing. The next step up is a real
browser driving the flows — which no suite in this repository does.

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
