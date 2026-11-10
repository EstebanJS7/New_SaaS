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

| ID  | Specs | Route                        | Status      | Commit / evidence                                                                                                                                                                                                                       |
| --- | ----- | ---------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S1,S8 | inline                       | done        | Build 13/13; live-pg block 5/5, including deterministic concurrent 201/409, one set of effects and winner-only idempotency. Commit recorded below. Risk: item 4 (real PostgreSQL concurrency); independent verification at feature end. |
| T2  | S2,S8 | delegated (context backstop) | in_progress | Disposable historical migration drill.                                                                                                                                                                                                  |
| T3  | S3,S8 | inline                       | pending     | Branch browser gate.                                                                                                                                                                                                                    |
| T4  | S4,S8 | inline                       | pending     | Preserve and document permission-first 403.                                                                                                                                                                                             |
| T5  | S5,S8 | inline                       | pending     | Printable ASCII idCsc.                                                                                                                                                                                                                  |
| T6  | S6,S8 | inline                       | pending     | Bounded JSON proxy. Risk: item 2 (payload guard).                                                                                                                                                                                       |
| T7  | S7,S8 | inline                       | pending     | Stable retirement serialization conflict.                                                                                                                                                                                               |
| T8  | S1-S8 | independent verify + inline  | pending     | Final checks, review as due, evidence and handoff.                                                                                                                                                                                      |

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
- L4: Test-only gates may already pass without product changes; no artificial
  RED or intentional product regression will be introduced when no meaningful
  RED applies. New behavioral fixes require observed RED first.
