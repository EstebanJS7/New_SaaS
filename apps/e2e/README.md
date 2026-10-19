# `@newsaas/e2e` — the browser lane

A **runnable test target, not a deployable service**. It deploys nothing, ships
nothing, and runs in CI and on a developer's machine only.

## Why it exists

Every other suite in this repository reads code or drives one layer. This one
drives a **browser** against the **built** apps, which is the only way to catch
the class of defect this session kept finding by hand: a page that does not
exist, a proxy that answers 500, a form that renders and does not submit. Three
of those were found by a human looking or by a hand-run `curl`, and none by a
test.

## Running it

```bash
docker compose up -d          # PostgreSQL and Redis
pnpm install
pnpm build                    # the lane drives the BUILT apps, not the dev servers
DATABASE_URL=postgresql://newsaas:newsaas@localhost:5432/newsaas \
  pnpm --filter @newsaas/e2e e2e
```

The lane migrates and seeds the database itself (`global-setup.ts`), starts the
API and the web app itself (`webServer`), and reuses them if you already have
them running locally.

A failing run writes a trace; `pnpm --filter @newsaas/e2e e2e:report` opens it.

## What each spec needs

| spec                              | needs                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `staff-sign-in`, `portal-sign-in` | PostgreSQL, Redis, the built API and web                                             |
| `staff-recovery`                  | the same, plus the **worker** (it mints the token at send time) and an **SMTP sink** |

The recovery spec starts the worker itself and listens on port 2526 as a minimal
SMTP server, because there is no other place the link exists: the channel fake
never logs a recipient, the delivery row does not hold the message, and a
plaintext token is never stored. It also runs the real `nodemailer` adapter.

**Every run uses a fresh recoverable identity.** A staff recovery delivery is
deduped per `(profileId, hour)`, the delivery table refuses a DELETE by design,
and a profile can never be erased once it has acted. The config therefore sets
`DEMO_RECOVERABLE_EMAIL` to a new address per run, which is a new profile id,
which is a new dedupe key — and nothing is deleted, because the identities
earlier runs used are history.

The worker's environment is the complete set a real adapter needs
(`NOTIFICATION_EMAIL_ENV_VARS`): `EMAIL_PROVIDER=smtp`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and
`NOTIFICATION_EMAIL_FROM`. The channel module refuses a boot when any of them is
missing, which is the right rule and which the lane had to learn one variable at
a time.

## What it does NOT prove

- **It is not the gate.** A browser test is slower and flakier than a unit test.
  The fast suites stay the primary evidence, and this lane is deliberately
  excluded from `pnpm test` — its script is `e2e` so turbo's root `test` task
  cannot pick it up and make the whole gate require a live stack.
- **It covers a handful of flows, not the product.** What is not in a spec is
  not checked.
- **Its selectors are a contract.** `data-testid` and visible text; a spec that
  breaks because copy changed is a spec telling you copy changed.

## Local environment note

Chromium needs `libasound.so.2`. Where it is missing and there is no root:

```bash
mkdir -p /tmp/pwlibs && cd /tmp/pwlibs
apt-get download libasound2t64 && dpkg-deb -x libasound2t64_*.deb ./extracted
export LD_LIBRARY_PATH=/tmp/pwlibs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
```

CI (`ubuntu-latest`) installs it properly with
`npx playwright install --with-deps chromium`.
