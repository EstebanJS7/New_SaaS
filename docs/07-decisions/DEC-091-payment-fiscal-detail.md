---
id: DEC-091
type: decision
title: Payment detail for the factura electrónica's gCamFE and gCamCond
status: accepted
date: 2026-11-03
related_epics: [EPIC-12, EPIC-16]
related_stories: [PAY-DET-001, FISC-008, NCE-001]
prd_change_required: false
---

# DEC-091 — Datos del pago para `gCamFE` y `gCamCond`

## Contexto

[[TD-074]]: la factura electrónica no llevaba `gCamFE` ni `gCamCond`, que el
Manual Técnico v150 exige para `C002 = 1` (reglas 1350 y 1500). SIFEN la
rechazaría. Para describir los pagos, SIFEN pide datos que la caja no guardaba.
Esteban Jiménez decidió el 2026-11-03 **agregarlos en caja** («agregalos»).

## Decisiones

1. **Nuevas columnas en `payment`, nulas.** Un INSERT guard las exige por medio
   de pago desde ahora; las CHECK impiden datos que no correspondan al medio.
   Los pagos anteriores quedan como están.
2. **Qué pide la caja, y cómo se informa a SIFEN (`iTiPago`):**

   | Medio en caja | Se pide                                      | SIFEN                                         |
   | ------------- | -------------------------------------------- | --------------------------------------------- |
   | Efectivo      | nada                                         | 1 Efectivo                                    |
   | Tarjeta       | crédito o débito; marca (o nombre si «Otra») | 3 / 4 y `gPagTarCD`                           |
   | Transferencia | nada                                         | 5 Transferencia                               |
   | QR            | billetera electrónica o app del banco        | 7 Billetera electrónica / 21 Pago Electrónico |
   | Cheque        | número (hasta 8 dígitos) y banco             | 2 Cheque y `gPagCheq`                         |
   | Otro          | descripción (4 a 30 caracteres)              | 99 con esa descripción                        |

3. **Valores fijos**, porque es lo que hace una clínica: `iIndPres = 1`
   «Operación presencial», `iCondOpe = 1` «Contado» (los pagos suman exactamente
   el total, [[DEC-029]], no hay crédito) e `iForProPa = 1` POS.
4. **El cheque se completa con ceros a la izquierda** hasta 8 dígitos, como pide
   el Manual («Completar con 0 a la izquierda»).
5. **Una factura de una venta cobrada antes de esta migración** con tarjeta, QR,
   cheque u «Otro» no se construye: el ensamblado responde
   `PAYMENT_DETAIL_MISSING` en vez de inventar el dato. Efectivo y transferencia
   no necesitan nada. Antes del piloto no hay datos reales afectados.
6. **La huella de idempotencia** del cobro incluye el detalle solo cuando
   existe, así un pago sin detalle conserva la huella que tenía.
7. **Validación previa al envío**: `assertValidDteRequest` controla 1350/1351/
   1352, 1500/1501/1502, 1550, 1554, 1600/1601/1602 y el formato de `gPagCheq`.
   La nota de crédito no lleva ninguno de los dos grupos.

## Fuera de alcance

- Venta a crédito (`gPagCred`), código de autorización, procesadora y últimos
  cuatro dígitos de la tarjeta (opcionales en el XSD).
- Mostrar el detalle del pago en el detalle de la venta.

## Decisión

Aceptada el 2026-11-03.
