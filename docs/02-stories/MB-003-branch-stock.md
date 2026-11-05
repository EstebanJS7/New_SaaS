---
id: MB-003
type: story
title: Stock per branch, purchases and transfers
epic: EPIC-10
status: done
priority: high
depends_on: [MB-001, MB-002]
prd_sections: ["§16", "§17"]
permissions: [inventory.stock.transfer]
branch:
created: 2026-11-04
updated: 2026-11-04
---

# MB-003 — Stock por sucursal, compras y transferencias

## Objetivo

Que cada sucursal tenga su propio stock (su único depósito), que las compras
ingresen en una sucursal y que se pueda mover mercadería entre sucursales.
Tercera entrega de [[DEC-094]] (§10).

## En alcance

- **Base de datos** (`20261108000001_branch_stock`):
  - `stock_movement.branch_id` (`NOT NULL`, FK compuesta por clínica) y
    `stock_movement.transfer_id`.
  - Tipos nuevos `TRANSFER_OUT` y `TRANSFER_IN`, agregados al final.
  - CHECK `stock_movement_transfer_pairing`: hay `transfer_id` si y solo si el
    tipo es de transferencia. Índice único `(transfer_id, type)`: una salida y
    una entrada por transferencia.
  - `stock_balance.branch_id`: el saldo es único por (clínica, ítem, sucursal).
  - `purchase.branch_id` (`NOT NULL`, FK compuesta).
  - Relleno: lo existente va a la sucursal más antigua de cada clínica; una
    clínica con stock o compras y sin sucursal recibe «Casa central».
- **API:**
  - `GET /inventory/stock` devuelve un saldo por (ítem, sucursal) con
    `branchId` y `branchName`; acepta `?branchId=`.
  - `GET /inventory/stock/branches` (lectura de stock): sucursales activas de
    la clínica, para filtrar y elegir destino sin `branches.manage`.
  - `POST /inventory/stock/adjustments` acepta `branchId` opcional, con la regla
    de MB-002 (la única sucursal donde se trabaja; con varias pide elegir).
  - `POST /inventory/stock/transfers` (`inventory.stock.transfer`): origen
    donde se trabaja, destino activo y distinto, cantidad positiva. Bloquea las
    dos sucursales en orden fijo, rechaza dejar el origen en negativo (409),
    escribe la salida y la entrada con el mismo `transferId` y un solo registro
    de auditoría sin el motivo.
  - Compras: `POST /purchases` acepta `branchId` opcional (misma regla);
    recibir exige trabajar en la sucursal de la compra y suma stock allí.
  - Ventas: completar descuenta de la sucursal de la venta; anular devuelve a
    la sucursal de la que salió cada movimiento.
  - Informe de stock: «Todas» (suma por ítem) y sin contar transferencias como
    entrada o salida, hasta MB-004.
- **Web:**
  - Pantalla nueva **Comercio › Stock** (`/app/inventory`): saldos por
    sucursal con filtro («Todas» por defecto) y formulario de transferencia,
    visible solo con dos o más sucursales activas.
  - Proxy `/api/inventory` con lista cerrada: saldos (solo `branchId` en la
    consulta), sucursales y transferencia.
  - Compra nueva: pide la sucursal que recibe solo a quien trabaja en varias.
    El detalle muestra la sucursal.

## Fuera de alcance

- Ajustes de stock desde la web (la API ya los acepta por sucursal).
- Historial de transferencias en pantalla.
- Filtro por sucursal en reportes (MB-004).

## Verificación

- API: ajuste por sucursal (pide elegir, rechaza ajena); transferencia
  (par OUT/IN, saldos, una auditoría, stock insuficiente, origen ajeno,
  destino inactivo, cuerpo inválido, permiso); listado por sucursal;
  sucursales activas; compra creada y recibida en su sucursal y rechazo en una
  ajena; venta que descuenta de su sucursal; informe que suma sucursales y
  excluye transferencias; anulación que devuelve a la sucursal de origen;
  ruta nueva fijada en el probe.
- Web: proxy (lista cerrada), pantalla de stock (filtro, transferencia,
  error de stock insuficiente, una sola sucursal), formulario de compra,
  build de Next.
- Drill en PostgreSQL 16: relleno a la sucursal más antigua y «Casa central»
  si faltaba; rechazos del CHECK de pares, del duplicado por transferencia,
  del saldo duplicado por sucursal, de una sucursal de otra clínica y de
  movimientos o compras sin sucursal.
- **Pendiente:** `live-pg-isolation.e2e-spec.ts` se adaptó (`branch_id` en los
  inserts directos) pero no se pudo correr acá; prueba en navegador.
