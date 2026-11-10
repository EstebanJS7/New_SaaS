# SAL-REV-001 / MB-001 / FISC-019 verification

Branch: `test/sal-rev-concurrency-mb001` from `main` (`3191dc0`); no publishing.
Local work-unit commits; delivery strategy `single-pr` (user selected); no
publishing authorized. Runners: Vitest live-pg, focused API/web Vitest,
Playwright, lint/format/typecheck. Forecast: approximately 900 authored lines
across separate behavior units.

## Specs

- S1: "Agregá al bloque \"SAL-REV-001 completed-sale reversal…\" de
  `apps/api/test/live-pg-isolation.e2e-spec.ts` un caso con dos
  `POST /sales/:id/reverse` concurrentes sobre la misma venta cobrada en
  efectivo, con claves distintas." "Esperado: exactamente un `201` y un `409`
  (\"La venta ya fue anulada.\"). Una sola fila `sale_reversal`, un solo
  movimiento `REFUND`, una sola compensación `SALE_REVERSAL` y una sola
  auditoría `sale.reversed`." "Si encontrás una carrera real en el producto, no
  la tapes en el test: arreglá el servicio
  (`apps/api/src/sales/sale-reversal.service.ts`), con su test, y registralo."
- S2: "Migración con datos: en una base desechable, aplicá las migraciones hasta
  la anterior a MB-001, sembrá datos representativos (tenant, personal, ventas,
  caja, stock y turnos), aplicá el resto y verificá el backfill: cada tenant
  queda con su primera sucursal y cada miembro asignado, sin filas huérfanas.
  Dejalo como test o script reproducible (live-pg o un script en `scripts/`) y
  documentá cómo se corre."
- S3: "Navegador: una spec en `apps/e2e/specs/` que, en «Configuración ›
  Sucursales», cree una sucursal, asigne personal, verifique las restricciones
  de la story (no desactivar la última activa ni una con turnos pendientes) y
  vea que la caja y las ventas respetan la sucursal de trabajo. Reutilizá
  `apps/e2e/support/staff.ts`."
- S4: "Antes de cambiarlo, decidí con el usuario si ese orden importa:
  preguntale una sola vez. Si no importa, documentalo como comportamiento
  conocido." User accepted recommended option: "Mantener el 403 actual y
  documentarlo" with "ok hazlo".
- S5: "Alineá la validación del formulario con la de la API (la API es la
  autoridad) y agregá un test."
- S6: "Agregá un tope razonable (por ejemplo 64 KiB), con respuesta 413 y su
  test. Fijate si otros proxies ya tienen un helper para esto y reutilizalo."
- S7: "si al retirar un CSC ocurre un fallo de serialización (`P2034`), hoy sale
  como 500. Mapealo a un 409 con un mensaje estable y agregá un test."
- S8: "Test primero: RED, después GREEN, en cada regla. No debilites tests
  existentes." "antes de cerrar corré `pnpm lint`, `pnpm format-check`,
  `pnpm typecheck` y los tests afectados. Los de la API y la web completos los
  corre el CI." "Commits: Conventional Commits, sin atribución de IA, una unidad
  por commit, con los docs de la story junto al código." "No toques
  `opencode.json` ni `.gentle-ai-default-agent.json`". "No toques los
  contenedores `newsaas-verify-*`". "no hagas push ni abras PR sin que el
  usuario lo pida."

## Tasks

| ID  | Specs | Route                        | Status | Commit / evidence                                                                                                                                                                                                                                                                                                                           |
| --- | ----- | ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S1,S8 | inline                       | done   | Build 13/13; live-pg block 5/5, including deterministic concurrent 201/409, one set of effects and winner-only idempotency. Commit `5d8262c`. Risk: item 4 (real PostgreSQL concurrency); independent verification at feature end.                                                                                                          |
| T2  | S2,S8 | delegated (context backstop) | done   | Worker and parent GREEN: nine assertion groups, 60 historical migrations, four tenants, four members, six assignments, preserved operational rows and no orphans. Script 1,330 lines uses explicit fixtures; no product/migration change. Commit `f63bc3f`.                                                                                 |
| T3  | S3,S8 | delegated (context backstop) | done   | Worker build 17/17; browser 1/1 twice, e2e lint/typecheck/format pass; parent format/diff spot-check pass. Only missing libasound requires documented LD_LIBRARY_PATH. Commit `3da8142`.                                                                                                                                                    |
| T4  | S4,S8 | inline                       | done   | Documented controller-permission-first behavior; no runtime change; Prettier corrected then passed. Commit `6a789f1`.                                                                                                                                                                                                                       |
| T5  | S5,S8 | inline                       | done   | RED: punctuation rejected (1 fail/10 pass); GREEN fiscal settings 31/31. Commit `175ed25`. Risk: item 2 (secret form validation); final verifier.                                                                                                                                                                                           |
| T6  | S6,S8 | delegated (context backstop) | done   | RED 8 fail/27 pass; GREEN route 35/35, combined fiscal web 66/66 parent; types/lint/format pass; differential 32 unchanged + expected oversized rejection. Commit `797d448`. Risk: item 2; final verifier.                                                                                                                                  |
| T7  | S7,S8 | inline                       | done   | Commit `5445aee`: RED 1 fail/10 pass → GREEN fiscal CSC/signing/RBAC 111/111, including rollback and unrelated error propagation. Risk: item 2 (secret lifecycle error handling); final verifier.                                                                                                                                           |
| T8  | S1-S8 | independent verify + inline  | done   | Build 17/17; root lint/format/types pass after repair; API isolation 277/277, reporting 6/6 on single isolated rerun after initial p95 failure; browser 3/3. Independent probes 57/57, no product blockers, environmental incident resolved without verifier retry. Native assessment unavailable; no lineage. Final evidence commit below. |

## Log

- L1 (2026-11-09): Original user request: "Continuar NewSaaS: concurrencia
  SAL-REV-001, MB-001 y observaciones del verificador". Requirements quoted
  verbatim in S1-S8; full original request retained in this Pi session and
  Engram prompt. Tasks must proceed in order T1 → T2 (migration then browser) →
  T3 advisories. User requests single writer, dated evidence, per-task Engram
  updates under `odd/sal-rev-mb001/tasks`, and final Goal / Accomplished / Next
  Steps / Relevant Files summary and session closure. Live-pg:
  `DATABASE_URL_TEST='postgresql://postgres@127.0.0.1:55432/postgres?schema=public'`;
  rebuild `@newsaas/*` dist before tests. E2E services use ports
  54330/63790/19000; persistent lane requires convergent fixtures. Never use
  self-matching `pkill -f`.
- L2 (2026-11-09): Read AGENTS and both governance rules; recovered Engram
  4728-4735. HEAD matches main 3191dc0; only pre-existing user-local
  configuration differs. Read-only explorer mapped relevant source and tests.
  Four permitted disposable containers already running. RDD switch on (decided
  by default).
- L3 (2026-11-09): User "ok hazlo" accepts recommended permission-first
  behavior. No reordering of CSC/signing-material guards authorized or needed.
  Created feature branch from main.
- L5 (2026-11-09): User selected "Un solo PR — menos recomendado"; strategy
  single-pr, separate local work units, no publishing. T1 focused block GREEN
  5/5 (272 unrelated cases skipped); build 13/13. Existing service correctly
  serializes both requests; no meaningful RED for additional proof of
  implemented behavior. ASSESS with item 4 requires independent verification,
  scheduled once at feature end; native assessment initially unassessable
  because untracked local configuration has not been selected. Next unit
  delegated due runtime context backstop.
- L6 (2026-11-10): Final root gates job-4 passed: lint=0, format=0, typecheck=0
  (31/31 Turbo tasks). Independent verifier ran one archived-candidate scratch
  setup: CSC 11/11, proxy+form 46/46; no product blockers. HOWEVER scratch
  workspace node_modules symlinks let pnpm's install rewrite main workspace
  dependency links into the ephemeral child scratch and run Prisma postinstall.
  Child scratch removal left broken links in 17 packages (e.g.
  packages/database/node_modules/prisma). No tracked dependency/lock/schema
  files changed; generated schema only appears reformatted/reordered but
  semantic comparison could not run because Prisma resolution is now broken.
  Parent stopped, did not delete/reinstall/restore or rerun verifier. Ask user
  to authorize local frozen-lockfile/offline dependency repair preserving all
  tracked files and local configs; then resume remaining build, live-pg, browser
  and review routing. Independent verifier is not relaunched. Native ASSESS was
  unassessable due undeclared local untracked config; no review lineage or
  consent created.
- L7 (2026-11-10): User "ok hazlo" explicitly authorizes the proposed
  `pnpm install --frozen-lockfile --offline` local dependency repair preserving
  user configs, tracked dependency versions and lockfile, followed by pending
  functional verification. This is not permission to publish or repeat the
  independent verifier.
- L8 (2026-11-10): Authorized repair job-5 succeeded
  (`pnpm install --frozen-lockfile --offline`, exit 0, lockfile up to date,
  Prisma 6.19.3 regenerated from repository schema). Main-tree Prisma resolves
  again and no broken package dependency symlinks were found. SHA-256 of
  user-local configs, pnpm-lock.yaml, root package.json and tracked Prisma
  schema stayed identical. No cleanup/reset or version upgrade used. Final
  build/schema preparation job-6 running. Native inspect with untracked
  exclusion reports ready/no lineages, but ASSESS still rejects undeclared
  untracked files even for committed-only range; no reviewDue/continuation is
  available, no lineage started. Independent verifier is not rerun. Engram
  observation read then failed with runtime-contract probe timeout; no writes
  retried blindly.
- L9 (2026-11-10): Final build job-6 GREEN 17/17; 11 official DNIT XSDs
  prepared. Affected browser job-8 GREEN 3/3 (branches, sale reversal,
  electronic credit note with real signing/XSD path). Post-repair root gates
  job-9 GREEN lint=0, format=0, typecheck=0 (31/31 cached Turbo tasks). Full
  live-pg job-7 remains running; do not close until its completion event.
  API/web full unit suites remain CI-owned per user. No source changes since
  product commit 5445aee.
- L10 (2026-11-10): Full live-pg job-7: 282 pass / 1 fail (283 total). All 277
  isolation/application cases passed; reporting-performance passed 5/6, p95
  tripwire failed at 9580.0 ms > 8000 ms while browser/root checks also ran.
  This load-sensitive failure was already documented in Engram 4729; no
  causality claim or threshold change. One bounded rerun of the same
  reporting-performance file launched as job-10 without other checks; if it
  still fails, stop with that concrete missing gate. No product edits or
  verifier retry.
- L11 (2026-11-10): Isolated reporting job-10 GREEN 6/6; initial suite failure
  remains disclosed, not relabeled as a green full run. Every required
  functional gate now has observed passing proof. SAL-REV-001 and MB-001 marked
  done with dated evidence; FISC-019 advisories complete. Independent verifier's
  source review/probes found no product blockers; its environment mutation was
  separately repaired under explicit authorization and build/browser/root checks
  subsequently passed. Additional native assessment unavailable (untracked
  selection not accepted by ASSESS); no native verdict/approval claimed. Full
  API/web unit suites and remote CI intentionally not run per user. Final
  documentation/format/diff check and local evidence commit close this feature;
  no push/PR. Risk: items 2 (fiscal secret validation/guard/error handling) and
  4 (financial reversal concurrency proof).
- L4: Test-only gates may already pass without product changes; no artificial
  RED or intentional product regression will be introduced when no meaningful
  RED applies. New behavioral fixes require observed RED first.
