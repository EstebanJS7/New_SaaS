---
id: SAL-REV-001
type: story
title: Reversal of a completed sale
epic: EPIC-12
status: in-progress
priority: high
depends_on: [POS-003, CASH-002]
prd_sections: ["§16", "§18", "§19", "§20", "§40"]
permissions: [sales.reverse, sales.read]
branch:
created: 2026-11-03
updated: 2026-11-09
---

# SAL-REV-001 — Anulación de una venta cobrada

## Objetivo

Que un cobro equivocado se pueda corregir dentro del producto: anular la venta
entera, devolver el stock, registrar la devolución de cada pago y sacar el
efectivo de la caja, sin editar nada de lo que ya se registró. Resuelve
[[TD-018]] para ventas sin factura vigente. Decisión: [[DEC-089]].

## En alcance

- `POST /sales/:id/reverse` (`sales.reverse`, Propietario y Administración) con
  motivo obligatorio e `Idempotency-Key` opcional; `GET /sales/:id/reversal`.
- Compensación de stock con `SALE_REVERSAL`, devolución de efectivo con `REFUND`
  en la caja abierta, `payment_refund` por pago, venta a `CANCELLED`, auditoría.
- La finalización de una venta marca sus movimientos con `sale_id`.
- Web: "Anular venta" en el detalle de una venta completada, con motivo y
  confirmación; detalle de la anulación en una venta anulada.

## Fuera de alcance

- Devoluciones parciales (decisión de producto).
- Nota de crédito electrónica: la emite [[NCE-001]] dentro de la misma
  anulación.
- Contar la anulación en el período en que ocurrió dentro de los informes.

## Criterios de aceptación

- [x] Solo una venta `COMPLETED` se puede anular; un borrador, una venta ya
      anulada o una con borrador de factura se rechazan con `409`. Una con
      factura confirmada se anula con nota de crédito ([[NCE-001]]).
- [x] Sin `sales.reverse` responde `403` antes de leer datos.
- [x] Todo ocurre en una transacción, bajo el bloqueo de la venta y los bloqueos
      de stock por artículo en orden ascendente.
- [x] El original no se modifica: líneas, pagos y movimientos quedan intactos.
- [x] Cada compensación apunta a lo que compensa (`sale_id`,
      `reverses_movement_id`, `payment_id`, `cash_movement_id`).
- [x] Dos anulaciones de la misma venta son imposibles (UNIQUE en la base).
- [x] La misma clave con el mismo motivo repite el resultado; con otro motivo,
      `409`.
- [x] El efectivo exige una caja abierta y única.
- [x] Auditoría `sale.reversed` sin el texto del motivo.
- [x] Prueba contra PostgreSQL real del recorrido completo (suite live-pg).
- [x] Prueba en navegador (`apps/e2e/specs/sale-reversal.spec.ts`: anulación
      desde el detalle con motivo, devolución en efectivo, stock y caja leídos
      por la API, persiste tras recargar).

## API

### Agregado

```text
POST /sales/:id/reverse     sales.reverse   { reason }   Idempotency-Key opcional
                            201 anulación nueva · 200 repetición de la misma clave
GET  /sales/:id/reversal    sales.read      404 si la venta no tiene anulación
```

### Cambiado

```text
POST /sales/:id/complete    los movimientos de stock y caja que escribe llevan sale_id
```

## Base de datos

### Migración

```text
20261103000001_sale_reversal
  stock_movement_type + SALE_REVERSAL
  stock_movement.sale_id, cash_movement.sale_id   (nullable, FK compuesta)
  sale_reversal    (UNIQUE tenant+venta, motivo no vacío, solo inserción)
  payment_refund   (UNIQUE tenant+pago, monto > 0, efectivo <=> movimiento, solo inserción)
```

## Verificación

```text
2026-11-03 (sandbox):
  58 migraciones aplicadas con psql sobre PostgreSQL 16: OK
  simulacro de restricciones con SQL: doble anulación, motivo vacío, UPDATE/DELETE,
    pago devuelto dos veces, efectivo sin movimiento, monto cero, FKs entre
    tenants y borrado de la venta: todos rechazados
  typecheck api/web/worker/database, lint, prettier, next build: OK
  api: sale-reversal.service 13/13; suite api 1968 OK
  web: sale-reversal-panel 8/8, proxy de ventas 27/27, sale-detail 8/8
  database: 568 OK (1 falla PREEXISTENTE: ClinicalCreationReceipt sin @id)
No se pudo correr: suites que necesitan el motor de consultas de Prisma
  (bloqueado en el sandbox). Pendiente: pnpm test completo con PostgreSQL.

2026-11-09 (PostgreSQL 16 real, suite live-pg, bloque SAL-REV-001/UX-035):
  anulación de una venta cobrada en efectivo: SALE_REVERSAL +2.000 enlazado al
    movimiento SALE, saldo = libro (10.000), un REFUND en la caja abierta, un
    payment_refund enlazado, venta CANCELLED, una auditoría sale.reversed sin el
    motivo, un idempotency_record sale.reverse
  replay misma clave y motivo: 200, mismo id, sin filas nuevas; otra razón con la
    misma clave: 409; nueva anulación: 409 "La venta ya fue anulada."
  venta de otro tenant: 404 en anular y en leer la anulación, sin escrituras
  pnpm test:live-pg completo: 276/276
Pendiente: concurrencia real (dos anulaciones simultáneas). Navegador cubierto
  el 2026-11-09 por specs/sale-reversal.spec.ts.
```

## Tests agregados

- `apps/api/src/sales/sale-reversal.service.test.ts` (13)
- `apps/web/src/app/(app)/app/sales/[id]/sale-reversal-panel.test.tsx` (8)
- 3 casos nuevos en `apps/web/src/app/api/sales/[[...path]]/route.test.ts`
- Actualizados: `route-contract.probe.test.ts`, `reference-seed.test.ts`,
  `schema-sales.test.ts`, `schema-clinical.test.ts`, el doble en memoria.

## Limitaciones conocidas

- Una venta anulada sale de los informes de ventas del período en que se cobró.
- El detalle de una venta completada no muestra sus pagos (limitación previa de
  la lectura); la anulación sí muestra las devoluciones.
- Aún no hay prueba de concurrencia contra PostgreSQL real (el recorrido
  secuencial sí está cubierto por la suite live-pg).

## Observaciones fuera de alcance

- `route-contract.probe.test.ts` ya fallaba por 8 rutas de borradores e
  historial clínico (UX-023/UX-024) no declaradas en el inventario.
- `schema-conventions.test.ts` ya fallaba por `ClinicalCreationReceipt`.

## Decisiones / ADRs

- [[DEC-089]]
