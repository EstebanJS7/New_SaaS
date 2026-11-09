---
id: MB-002
type: story
title: Cash registers, sales and issuance points per branch
epic: EPIC-12
status: done
priority: high
depends_on: [MB-001]
prd_sections: ["§19", "§20"]
permissions: []
branch:
created: 2026-11-03
updated: 2026-11-03
---

# MB-002 — Cajas, ventas y punto de expedición por sucursal

## Objetivo

Que cada sucursal cobre en sus propias cajas y facture con su propio punto de
expedición. Segunda entrega de [[DEC-094]] (§9); en este punto reemplaza a
[[DEC-020]].

## En alcance

- **Base de datos** (`20261107000001_branch_cash_sales`):
  - `cash_register.branch_id` y `sale.branch_id`, `NOT NULL`, con FK compuesta
    por clínica.
  - Relleno: los datos existentes van a la sucursal más antigua de cada clínica.
    Una clínica con cajas o ventas y sin sucursal recibe «Casa central».
  - `branch.fiscal_establishment_id` + `branch.expedition_point`: los dos o
    ninguno, punto de tres dígitos, FK al establecimiento de la misma clínica, y
    un solo punto por sucursal (índice único parcial).
- **API:**
  - `POST /cash/registers` acepta `branchId` opcional. Sin él usa la única
    sucursal activa donde trabaja quien la crea; con varias pide elegir.
  - Abrir una caja exige trabajar en su sucursal y que esté activa.
  - `POST /sales` acepta `branchId` opcional con la misma regla. Al cobrar se
    exige trabajar en la sucursal de la venta.
  - El efectivo de una venta (y su devolución al anularla) va a la única sesión
    abierta de una caja **de la sucursal de la venta**. Los mensajes de «sin
    sesión» y «más de una sesión» se mantienen y ahora hablan de esa sucursal.
  - La numeración fiscal (factura y nota de crédito) usa el establecimiento y
    punto de la sucursal de la venta cuando los declara; si no, el punto por
    defecto del perfil fiscal.
  - `GET /memberships/me/branches` (solo autenticado) devuelve las sucursales
    activas donde trabaja quien pregunta.
  - `PUT /branches/:id` acepta `fiscalEstablishmentId` + `expeditionPoint`, y
    `GET /branches` devuelve también los establecimientos de la clínica.
  - Respuestas: la caja suma `branchId` y `branchName`; la venta suma
    `branchId`.
- **Web:**
  - El mostrador (POS) y el formulario de caja nueva piden la sucursal solo a
    quien trabaja en más de una.
  - Cada caja muestra su sucursal.
  - En Configuración › Sucursales, el formulario de edición permite elegir
    establecimiento y punto de expedición, y la lista muestra «Factura con
    002-001».
  - Los proxies aceptan `branchId` solo al crear caja o venta.

## Fuera de alcance

- Stock por sucursal y transferencias (MB-003).
- Filtro por sucursal en reportes (MB-004).
- Mostrar la sucursal en el detalle de la venta y en el listado de ventas.

## Verificación

- API:
  - Venta: elige sucursal, pide elegir si hay varias y rechaza una ajena.
  - Una sesión abierta en otra sucursal no recibe el efectivo; la de la sucursal
    de la venta sí.
  - Cobrar una venta de una sucursal ajena se rechaza.
  - Caja: se crea en la sucursal de quien la crea y se rechaza en una ajena; no
    se abre en una sucursal donde no se trabaja.
  - Numeración desde el punto de la sucursal, o el del perfil si la sucursal no
    declara uno.
  - Establecimiento ajeno o punto ya usado: rechazados.
  - `me/branches` declarado como solo autenticado en el probe de rutas.
- Web:
  - Mostrador y caja piden sucursal solo con varias.
  - Formulario de punto de expedición.
  - Proxies.
  - Build de Next.
- Drill en PostgreSQL 16:
  - El relleno usa la sucursal más antigua, y crea «Casa central» si faltaba.
  - Rechazos: punto incompleto, caja con sucursal de otra clínica y venta sin
    sucursal.
- **Pendiente:**
  - `live-pg-isolation.e2e-spec.ts` se adaptó (sucursal y asignación del
    propietario, `branch_id` en los inserts directos) pero no se pudo correr
    acá.
  - Prueba en navegador.

## Cambio de la prueba en memoria

La base en memoria de las pruebas ahora imita el alta real. Cada clínica nace
con «Casa central», y cada miembro creado trabaja en las sucursales activas que
existan en ese momento. Una caja o venta sembrada sin `branchId` va a la primera
sucursal.
