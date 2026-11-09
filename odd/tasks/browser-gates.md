# Browser gates for the #151 stories

Objective: close the pending browser criteria of ONB-001, PAY-DET-001, NCE-001,
SAL-REV-001 and UX-035 with Playwright specs in the CI lane (`apps/e2e/specs`).
Branch: `test/browser-gates`, stacked on `test/live-pg-reversal-attempts` →
`fix/ci-main-repair` (PR #152). Delivery: ask-on-risk. Runner: Playwright
(`pnpm --filter @newsaas/e2e e2e`).

## Specs

- S1 — User: "ok hagamoslo" (in reply to doing the pending browser tests of
  ONB-001, PAY-DET-001, NCE-001, SAL-REV-001 and UX-035).
- S2 — ONB-001: "Recorrido completo en el carril de navegador (WU-B)." The staff
  screen: "lista, invitar, reenviar, cambiar rol, suspender y reactivar, con
  confirmación y estados de carga, error y permiso."
- S3 — PAY-DET-001: "Prueba en navegador del cobro con cada medio." Scope: "al
  elegir Tarjeta, QR, Cheque u Otro aparecen los campos; «Revisar venta» no se
  habilita hasta completarlos; la revisión muestra el detalle."
- S4 — NCE-001: "Prueba en navegador." Objective: "Que una venta cobrada **y
  facturada electrónicamente** se pueda anular: la anulación emite una nota de
  crédito electrónica por el total y la envía a SIFEN."
- S5 — SAL-REV-001: "Prueba en navegador." Objective: "anular la venta entera,
  devolver el stock, registrar la devolución de cada pago y sacar el efectivo de
  la caja".
- S6 — UX-035: "Respuesta perdida reproducida contra PostgreSQL y navegador."
  (PostgreSQL half done in 40fcb89.) Objective: "Que una venta, una apertura de
  caja o un movimiento cuya respuesta se perdió se puedan identificar con
  certeza, incluso tras recargar la página, sin reenviar a ciegas ni comparar
  valores."
- Constraint (assumption): specs drive the merged product; a product change is
  made only for a proven defect, reported first.

## Tasks

| ID  | Specs | Route                                               | Status            | Evidence                                                                                                                              |
| --- | ----- | --------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S2-S6 | delegated (context backstop; one lane, serial runs) | done (S4 blocked) | S2 staff-team, S3 payment-detail, S5 sale-reversal, S6 recoverable-attempts (3); full lane 29/29 twice, 0 flaky. S4 blocked by TD-075 |

## Log

- L1 (2026-11-09, user): "ok hagamoslo"
- L2: The lane binds fixed ports 3000/3001/2526, so specs cannot run in parallel
  writers; one writer runs them serially.
- L3: S4 blocked: no supported path writes the fiscal profile's default
  establishment and expedition point (TD-075); credit-note reversal answers 409
  without it.
- L4: Observations for the user: a suspended member still reaches the app shell
  (every tenant request is 403); the dashboard shows the API's English
  permission message.
