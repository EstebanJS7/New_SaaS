---
type: qa
status: active
updated: 2026-08-13
---

# Release Checklist

## The browser lane (2026-10-19)

The smoke pass above closed what reading could close and named what it could
not: **no suite drove a browser**, so a page that renders and whose form does
not submit passed every check in this repository.

`apps/e2e` is that lane. It runs Chromium against the BUILT apps (PostgreSQL,
Redis, the API's own `start` command, `next start`) and covers nine flows:

```text
staff        sign in, land on the shell, a list with rows from the API
             Enter submits; a wrong password is refused
portal       sign in, land on the tenant home, the pet list with the holder's pets
             Enter submits; no session -> the tenant's sign-in page; a staff cookie is not a portal one
recovery     ask for a link, BE the SMTP server, follow the link, set a new password,
             sign in with it, the OLD one refused, the link single-use
```

**It found five defects before it was green**, and every one of them was found
by a human looking, or by a hand-run `curl`, in this same session — none by a
test:

1. `/app/settings/branding` was unreachable (found by the surface-integrity
   fence, fixed in the same session).
2. A test-only route shipped to production (`/app/placeholder`, same fence, same
   fix).
3. **None of the four sign-in and recovery forms was a `<form>`**: Enter did
   nothing.
4. **`pnpm --filter @newsaas/api start` did not work** — the production start
   command of a deployable pointed at a file the build does not emit.
5. **The demo tenant's portal was unsignable** — the seed created the holder's
   access row and no credential.

**What the lane does NOT cover, named rather than implied:**

- **The portal's recovery flow.** Its fixture is a portal holder, and the same
  hourly dedupe ceiling applies to it; regenerating a holder per run costs a
  fresh customer link, which is a bigger fixture than a staff profile. Recorded,
  not hidden.
- **A handful of flows, not the product.** What is not in a spec is not checked.
- **It is not the gate.** A browser test is slower and flakier than a unit test;
  the fast suites stay the primary evidence and the lane is deliberately outside
  `pnpm test`.

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
