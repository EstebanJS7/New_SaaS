---
id: TD-074
type: tech-debt
title: The factura electrónica omits gCamFE and gCamCond
status: resolved
severity: critical
owner: engineering
related_stories: [FISC-008, FISC-015, NCE-001]
created: 2026-11-02
updated: 2026-11-03
---

# TD-074 — La factura electrónica no lleva `gCamFE` ni `gCamCond`

**Bloquea la salida a producción con SIFEN.**

El Manual Técnico v150 exige, para una factura electrónica (`C002 = 1`):

- `E010 gCamFE` con el indicador de presencia `iIndPres`/`dDesIndPres` (regla
  1350).
- `E600 gCamCond` con la condición de la operación (`iCondOpe`: contado o
  crédito) y, para contado, un `gPaConEIni` por forma de pago (regla 1550), cuyo
  `iTiPago` distingue tarjeta de **crédito (3)** y de **débito (4)** y que, para
  tarjeta, exige `gPagTarCD` con la marca `iDenTarj` y la forma de procesamiento
  `iForProPa` (regla 1600).

El mapper (`dte.mapper.ts`) solo emite los ítems dentro de `gDtipDE`. El XSD los
declara `minOccurs="0"`, así que la validación contra el XSD pasa y SIFEN
rechazaría toda factura al recibirla. Evidencia en `SIFEN-BASELINE.md` §27.

## Qué falta decidir

El sistema guarda
`payment.method ∈ {CASH, CARD, BANK_TRANSFER, QR, CHECK, OTHER}`:

- `CARD` no dice si es crédito o débito ni la marca.
- `QR` no tiene un `iTiPago` evidente (7 billetera electrónica o 21 pago
  electrónico).
- `CHECK` exige `gPagCheq` con número y banco, que no se guardan.

Es una decisión de producto (qué se pide en caja) y de datos (columnas nuevas en
`payment`), no algo que el generador pueda inventar.

## Etapa propia

1. Decidir la captura en caja: crédito/débito y marca para tarjeta; tipo para
   QR; número y banco para cheque, o dejar de aceptarlo.
2. Migración aditiva en `payment`.
3. Emitir `gCamFE` (`iIndPres = 1`, presencial) y `gCamCond` (contado,
   `gPaConEIni` por pago) en el mapper; afirmar 1350/1500/1550/1600 en
   `assertValidDteRequest` (hoy quedaron fuera a propósito, ver la nota en
   `assertDocumentTypeGroups`).
4. Probar en el ambiente de test de SIFEN durante la habilitación.

La nota de crédito (`C002 = 5`) no lleva ninguno de los dos grupos, por eso
[[NCE-001]] no depende de esta deuda; pero no se puede emitir una nota sin una
factura aprobada antes.

## Resuelta — PAY-DET-001, 2026-11-03

La caja pide el detalle de cada pago ([[DEC-091]]) y la factura lleva `gCamFE` y
`gCamCond`; `assertValidDteRequest` controla 1350/1351, 1500/1501, 1550, 1554 y
1600/1601/1602. Falta la confirmación externa: el XSD oficial en CI y el
ambiente de test de SIFEN durante la habilitación ([[PAY-DET-001]]).
