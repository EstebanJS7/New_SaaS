# CI main repair

Objective: return `main` CI to green (all four jobs) before adding the
SAL-REV-001 / UX-035 live-pg tests. Branch: `fix/ci-main-repair` from `main` @
`9d3f32b`. Delivery: ask-on-risk. Runners: vitest (`pnpm test`, `test:live-pg`),
Playwright (`apps/e2e`), fiscal XSD suite.

## Specs

- S1 — User: "arreglemoslo" (in reply to fixing `main` CI first, starting with
  live-pg and lint, then adding the new tests).
- S2 — Job "Lint, Typecheck, Test, Build" green: `pnpm lint`,
  `pnpm format-check`, `pnpm typecheck`, `pnpm test`,
  `pnpm --filter @newsaas/api test:redis`, `pnpm build`.
- S3 — Job "DTE XSD validation" green: `pnpm --filter @newsaas/fiscal test` with
  `DTE_XSD_REQUIRED=1` and the fetched official schemas.
- S4 — Job "Database migrations" green, including `pnpm test:live-pg` in
  `apps/api` (baseline on `9d3f32b`: 26 failed / 204 passed / 42 skipped, plus
  `beforeAll` failures and `reporting-performance.live-pg-spec.ts`).
- S5 — Job "Browser end-to-end" green (baseline failures: clinical-records,
  imports x2, portal-sign-in staff/portal separation, recovery x2, reports).
- Constraint (assumption): repairs fix test fixtures/expectations to the
  behavior already merged (MB-00x, PAY-DET-001, ...); a product-code change is
  made only when a failure proves a real defect, and is reported.

## Tasks

| ID  | Specs | Route                                                         | Status           | Evidence                                                                                                                                                                                                                                                                                                         |
| --- | ----- | ------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S2    | inline                                                        | done (lint step) | trust-proxy test uses `response.json<{ ip: string }>()`; eslint clean, 4 tests pass                                                                                                                                                                                                                              |
| T2  | S3    | inline                                                        | done             | mapper XSD case passes payments (rule 1550); 812/812 with official XSDs                                                                                                                                                                                                                                          |
| T3  | S2    | inline + delegated (web tests, writer reason: parallel units) | in progress      | 13 `*.pg.test.ts` guarded with `if (!url) return;`; route probe declares 8 UX-023/024 routes (perms verified vs DEC-086/087); schema conventions name scoped/caller-keyed PK exceptions; surface-integrity strips query strings; web tests follow es-PY UI (2261/2261). Pending: format, typecheck, redis, build |
| T4  | S4    | delegated (parallel units)                                    | partial          | isolation spec green: 271/272; `provisionFirstBranch` fixture + schema expectations tied to #151 migrations. Open: reporting p95 tripwire 5.7–10.1 s locally vs 8 s budget, no baseline                                                                                                                          |
| T5  | S5    | delegated (parallel units)                                    | done             | 23/23, 0 flaky; staff selectors in Spanish; `support/es-py-format.ts`                                                                                                                                                                                                                                            |

## Log

- L1 (2026-11-05, user): "arreglemoslo"
- L2: CI red on every `main` push since `ebf998e` (2026-10-29); last green
  `a825ded`. On `9d3f32b` all four jobs fail.
- L4: No product code changed; every failure was test drift behind merged
  behavior (MB-00x branches, PAY-DET-001, NCE-001, es-PY localization,
  UX-019/023/024).
- L3: Local live-pg recipe: disposable `postgres:16-alpine` on 55432 with trust
  auth;
  `DATABASE_URL_TEST='postgresql://postgres@127.0.0.1:55432/postgres?schema=public'`.
