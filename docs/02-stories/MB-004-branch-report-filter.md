---
id: MB-004
type: story
title: Branch filter on reports
epic: EPIC-18
status: done
priority: high
depends_on: [MB-002, MB-003]
prd_sections: ["§31"]
permissions: []
branch:
created: 2026-11-05
updated: 2026-11-05
---

# MB-004 — Filtro por sucursal en reportes

## Objetivo

Que los reportes comerciales, de caja, de compras y de inventario puedan verse
para una sucursal, sin cambiar los números de quien no lo pide. Cuarta y última
entrega de [[DEC-094]] (§11); en este punto reemplaza a [[DEC-062]] y cierra
[[TD-052]].

## En alcance

- **API:**
  - `branchId` opcional (UUID) en `sales-by-period`, `payment-methods`,
    `sales-by-product-service`, `cash-sessions`, `cash-movements`, `purchases`,
    `stock` y `low-stock`. Sin él, «Todas»: la respuesta es igual a la de antes.
  - Con sucursal, la respuesta suma `branch: { id, name }`.
  - Ventas y cobros por la sucursal de la venta; caja por las cajas de la
    sucursal; compras por la sucursal que recibió; stock por el saldo y los
    movimientos de la sucursal. Filtrado por sucursal, una transferencia es
    entrada o salida real; en «Todas» no cuenta.
  - `low-stock` compara el saldo de esa sucursal con el umbral del ítem; sigue
    sin aceptar período.
  - Una sucursal de otra clínica responde igual que una inexistente (404, «La
    sucursal no existe.»). Una sucursal desactivada se acepta: tiene historia.
  - Los reportes veterinarios no aceptan `branchId` (400).
  - `GET /reports/branches` (`reports.read`): todas las sucursales de la
    clínica con su estado, para el filtro.
  - Exportación CSV: las mismas reglas que cada reporte; el nombre del archivo
    no cambia.
- **Web:**
  - Selector «Branch» en esos ocho reportes, con «All branches» por defecto,
    visible solo si la clínica tiene más de una sucursal. La exportación usa
    la misma sucursal.
  - El proxy de reportes acepta `branchId` solo en esos reportes y sirve
    `/api/reports/branches` sin parámetros.

## Fuera de alcance

- Filtro por sucursal en los reportes veterinarios.
- Comparar sucursales lado a lado en una misma tabla.
- Agregar la sucursal al nombre del archivo exportado.

## Verificación

- API: lista de sucursales; ventas, caja, compras, stock y stock bajo con y sin
  sucursal; sucursal ajena o inexistente; UUID inválido; sucursal en un
  reporte veterinario; exportación filtrada; ruta nueva fijada en el probe.
- Web: proxy (reenvío y rechazos), selector de sucursal (por defecto, cambio,
  exportación, una sola sucursal, reporte veterinario), build de Next.
- **Pendiente:** prueba en navegador.
