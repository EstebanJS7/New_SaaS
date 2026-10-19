---
feature: playwright-e2e-lane
epic: EPIC-19
status: in-progress
created: 2026-10-19
updated: 2026-10-19
branch: feat/playwright-e2e-lane
---

# The Playwright E2E lane — ODD task tracker

## Goal

Close the gap the surface smoke pass named and could not close: **no suite in
this repository drives a browser**, so a page that renders and whose form does
not submit passes every check the repository has.

Three defects of this session were found by a human looking or by a hand-run
`curl`, and **none by a test**:

| defect                          | how it was found       |
| ------------------------------- | ---------------------- |
| the login page did not exist    | looking at the product |
| TD-049 — the portal proxy's 500 | live instrumentation   |
| TD-050 — the twelve BFF proxies | a hand-run curl        |

All three would have failed a browser test that signs in and opens a page.

## Why this is not an ADR

`AGENTS.md`'s complexity budget gates a new runtime/deployable service, a
database, a broker, an ORM, an auth provider, a frontend state library, a
protocol, WebSocket infrastructure, a generic cross-domain framework, an event
bus, a CSS foundation, micro-frontends and extra data stores. **A browser test
runner is none of those.** `apps/e2e` deploys nothing and runs in CI and on a
developer's machine only; the directory is a runnable test target, not a
service. What the budget does require — a concrete requirement the current stack
cannot meet — is above, and it is concrete: the current stack (jsdom +
testing-library) proves a form _calls_ `fetch` and cannot prove the integration
through a real BFF, a real cookie, a real redirect and a real hydrated page,
which is exactly where this session's bugs lived.

## Decisions taken here (technical, not product)

1. **`@playwright/test`, not vitest.** Its own runner gives fixtures, retries,
   traces and an HTML report, and a trace on failure is the whole reason a
   browser test is worth having.
2. **The lane is a package, and its script is NOT `test`.** `apps/e2e` is a
   workspace package (`apps/*`) so CI can filter it, but its script is `e2e`:
   turbo's root `test` task would otherwise pick it up and make `pnpm test`
   require a live PostgreSQL, Redis, a built API and a built web app. The lane
   is opt-in and named separately, deliberately.
3. **`webServer` boots the API and the web app; `globalSetup` does the rest.**
   Playwright already knows how to start HTTP servers, poll them and tear them
   down. Migrations, the demo seed and the SMTP sink are `globalSetup`'s.
4. **The worker joins in WU-3 only.** The first two flows do not cross it; the
   recovery flow does, because the token is minted at send time.
5. **`next start`, not `next dev`.** The lane runs the production build, which
   is what the BFF defects appeared in. The cost is a build step, documented.
6. **The recovery flow uses a REAL SMTP sink, not the channel fake.** The fake
   retains attempts in memory and deliberately never logs a recipient, and the
   delivery row does not hold the message (content is built at send time, and a
   plaintext token is never stored). So the only honest way to read the link is
   to be the SMTP server. It also exercises the real `nodemailer` adapter.

## Work units

- [x] **WU-1 — the lane, and the first real flow.** `apps/e2e` skeleton,
      `playwright.config.ts`, the stack bootstrap (migrate + demo seed), the
      staff sign-in flow (sign in → land on `/app` → open a list from the nav),
      the CI job, and the lane's README. The CI job lands here because the
      plumbing is the risky half and it should be proven in CI before three
      flows depend on it.
- [ ] **WU-2 — the portal flow.** Sign in at `/[slug]/login` → open a pet → and
      the gate: a protected page without a session redirects to the login.
- [ ] **WU-3 — the recovery flow, end to end.** Request a reset → be the SMTP
      server → decode the message → follow the link → set a new password → sign
      in with it. Needs Redis, the worker and the sink. This is the flow the
      session ran by hand and the one worth automating most: it is the only one
      that proves the link that leaves by mail works.
- [ ] **WU-4 — the records.** The lane's README, the QA record, and CI evidence.

## Constraints and risks

- **Timing is the new failure mode.** Mitigation: a few flows, the
  `data-testid`s the app already has, and Playwright's auto-waiting rather than
  sleeps. No `waitForTimeout` in a spec.
- **A browser is a big binary.** ~120 MB, cached by Playwright; CI installs it
  with `--with-deps`.
- **This environment cannot run it without a workaround**: `libasound.so.2` is
  missing and there is no sudo. `apt-get download libasound2t64` needs no root,
  and extracting the `.deb` plus `LD_LIBRARY_PATH` makes Chromium launch. CI
  (`ubuntu-latest`) has root and installs it properly.
- **The lane must not become the gate.** A browser test is slower and flakier
  than a unit test; the repository's fast gates stay the primary evidence.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.

## Evidence

### WU-1 — the lane, the first flow, and the CI job

The lane runs and the spec passes, driven by a real Chromium against
`next start` and the API's own `start` command:

```text
3 passed (16.7s)
  ✓ signs in, lands on the shell, and a list renders rows from the API
  ✓ submits with the Enter key, the way a password manager and every user expect
  ✓ refuses a wrong password without saying which half was wrong
```

The API's own log in the same run shows the real requests: `POST /auth/login` →
401 for the wrong password, `/branding/current` → 200 for the shell.

**It found two defects before it was green, and both were real:**

1. **The sign-in form was not a `<form>`.** The inputs sat in a `Card` and the
   button was `type="button"`, so pressing **Enter did nothing at all** — the
   most ordinary gesture of anyone signing in, and of every password manager.
   Fixed: a real `<form onSubmit>` and a `type="submit"` button. The spec
   asserts the keyboard path, so it cannot regress.
2. **`pnpm --filter @newsaas/api start` did not work.** The script ran
   `node dist/main.js` while the build emits `dist/src/main.js` (`rootDir: "."`
   plus `test/**/*` in the include). Nobody had ever run the production start
   command of a deployable, so nothing had reported it. The lane starts the API
   through that command deliberately — a lane that started it some other way
   would keep passing while the command a deployment runs stayed broken.

The worker's `start` was checked in the same pass and is correct
(`rootDir: "./src"`, so `dist/main.js` is the real path).

**Environment notes that cost a run each:**

- Chromium needs `libasound.so.2`, missing here with no root.
  `apt-get download libasound2t64` needs no permissions and the extracted `.deb`
  plus `LD_LIBRARY_PATH` is enough. CI installs it with `--with-deps`.
- The lane must read the repository's `.env`: this repository maps **non-default
  host ports** in `docker-compose.yml` (PostgreSQL 5433, Redis 6380), and a lane
  that assumed 5432 fails for reasons that have nothing to do with the product.
  `load-env.ts` fills only unset variables, so an explicit export always wins.
- The first failure of the main spec was the SPEC's fault, not the product's:
  `getByText` matched the row's link and its subtitle, which is a strict-mode
  violation. The row's **link** is what a user clicks.

**Recorded as still open at this point:** the same missing-`<form>` pattern
existed in the portal's sign-in form and in the recovery forms. Each is fixed in
the work unit that drives it, so the fix lands with its own spec rather than as
a sweep nobody tested.

### WU-2 — the portal flow

```text
7 passed (18.6s)   — the portal's four plus the staff's three
  ✓ signs in, lands on the tenant home, and the pet list has the holder's pets
  ✓ submits with the Enter key, like the staff form it was modelled on
  ✓ sends a visitor with no session to the sign-in page, keeping the tenant
  ✓ keeps staff and portal sessions apart: a staff cookie is not a portal session
```

**The lane found the same missing-`<form>` defect in the portal's sign-in
form**, which was modelled on the staff one and inherited it exactly. Fixed the
same way, and the spec asserts the keyboard path here too.

**The demo seed could not sign into its own portal.** It created the holder's
access row and NO credential, so the portal half of the demo tenant was unusable
— by a human as much as by the lane. The seed now writes one (an upsert, with
the owner credential's "refresh keeps it usable if the parameters evolve"
rationale), and `DEMO_PORTAL_HOLDER_PASSWORD` is a published constant. Its unit
suite asserts the row is written with the hash it was GIVEN, so the seed still
never sees a plaintext password.

**Two assertions worth more than they cost**: the gate (no session → the
tenant's sign-in page, tenant preserved) and the identity boundary (a browser
holding a STAFF session is still sent to the portal's sign-in page — the two
identities share a browser and nothing else, [[DEC-008]] one level down).

**Both first failures of the new specs were the SPEC's fault, not the
product's**: `getByText` and `getByRole("link")` each matched two elements. A
strict-mode violation is a selector that is too broad, and narrowing it — to the
row's link, to the portal's own nav — is the fix. Worth recording because "the
test failed" and "the product is wrong" are different claims.
