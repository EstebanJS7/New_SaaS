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
