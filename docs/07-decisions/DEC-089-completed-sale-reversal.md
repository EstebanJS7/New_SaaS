---
id: DEC-089
type: decision
title: Reversal of a completed sale
status: accepted
date: 2026-11-03
related_epics: [EPIC-12, EPIC-13, EPIC-14]
related_stories: [SAL-REV-001]
prd_change_required: false
---

# DEC-089 — Anulación de una venta cobrada

## Contexto

Una venta `COMPLETED` era inmutable y no había forma de corregirla dentro del
producto ([[TD-018]]). PRD §40 y `docs/03-architecture/REVERSALS-CORRECTIONS.md`
fijan el contrato: conservar el original, crear compensaciones, vincularlas,
exigir motivo, registrar actor y momento, ser idempotente y quedar auditado.

Al explorar el esquema apareció un hueco que el contrato no previó: los
movimientos `SALE` de stock y de caja **no guardaban de qué venta venían**, así
que una anulación no podía encontrar lo que compensa.

## Decisiones de producto (Esteban Jiménez, 2026-11-02)

1. **Alcance: anulación total.** Se anula la venta entera; no hay devoluciones
   parciales en el lanzamiento.
2. **Permiso: Propietario y Administración** (`sales.reverse`). Caja cobra pero
   no deshace cobros.
3. **Ventas facturadas: nota de crédito electrónica (NCE).** La NCE es una Story
   propia (Billing + Fiscal). Implementada por [[NCE-001]] / [[DEC-090]]
   (2026-11-02): la anulación emite la nota en la misma transacción.

## Decisiones técnicas

- **Ruta propia `POST /sales/:id/reverse`**, no una sobrecarga de
  `POST /sales/:id/cancel`. La convención de REVERSALS-CORRECTIONS sugería
  reutilizar `cancel`, pero cancelar un borrador y anular una venta cobrada
  tienen permisos distintos (`sales.cancel` / `sales.reverse`), cuerpos
  distintos (vacío / motivo) y efectos distintos. Se lee con
  `GET /sales/:id/reversal`.
- **`sale_id` en `stock_movement` y `cash_movement`** (nullable, FK compuesta
  por tenant). La finalización lo escribe desde ahora; los movimientos
  anteriores quedan en null porque no se pueden completar con certeza.
- **`SALE_REVERSAL`** se agrega a `stock_movement_type` (estaba reservado). Cada
  `SALE` original se compensa con un `SALE_REVERSAL` positivo que lo apunta por
  `reverses_movement_id`. Una venta anterior a esta decisión, sin movimientos
  marcados, se compensa desde sus líneas que controlan stock, sin ese vínculo.
- **`sale_reversal`**: una fila por venta (UNIQUE), con motivo, actor, momento y
  la caja de la que salió el efectivo. Solo inserción.
- **`payment_refund`**: una fila por pago original, con su método y monto; la de
  efectivo apunta al movimiento `REFUND`. Solo inserción. El pago original no se
  modifica.
- **El efectivo sale de la caja abierta ahora**, que puede no ser la caja donde
  entró. Si no hay una caja abierta, o hay varias, la anulación se rechaza con
  los mismos mensajes que la finalización.
- **Estado**: `COMPLETED → CANCELLED`, condicional a `COMPLETED`. `completed_at`
  se conserva.
- **Idempotencia**: `Idempotency-Key` opcional sobre `idempotency_record` con la
  operación `sale.reverse` y huella `sha256(saleId, motivo)`.

## Impacto

### Producto

Una venta mal cobrada se corrige anulándola y volviendo a cobrar.

### Informes

Los informes de ventas cuentan solo `status = COMPLETED`, así que una venta
anulada **desaparece del período en que se cobró**, no figura como devolución en
el período en que se anuló. El informe de caja sí refleja el `REFUND` en la
sesión donde ocurrió. Para el piloto es aceptable; un informe contable
necesitaría contar la anulación en su propio período.

### Base de datos/API

Migración `20261103000001_sale_reversal`, aditiva. Permiso nuevo `sales.reverse`
(catálogo 67 → 68).

## Decisión

Aceptada el 2026-11-03.

## Actualización del PRD

No requiere: PRD §40 ya incluye "Sale cancellation/reversal" y "Payment
refund/reversal".
