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
branch: docs/mb002-verification-reconcile
created: 2026-11-03
updated: 2026-11-09
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
- Live PostgreSQL: `live-pg-isolation.e2e-spec.ts`, adaptado (sucursal y
  asignación del propietario, `branch_id` en los inserts directos), corre en el
  job «Database migrations» del CI (`pnpm test:live-pg`); verde en `main`
  `3191dc0` (ejecución 42719450399) y en el PR #160 (ejecución 42738153889).
- Navegador: `apps/e2e/specs/branches.spec.ts` (MB-001, PR #160), ver abajo.

## Prueba en navegador

`apps/e2e/specs/branches.spec.ts` cubre la parte de caja y ventas de esta story
con una segunda sucursal donde trabaja el propietario:

- Caja nueva: el formulario pide «Sucursal» porque se trabaja en dos; la caja
  queda en la sucursal elegida y la lista muestra su sucursal.
- Abrir sesión en esa caja.
- Mostrador: pide «Sucursal de la venta»; la venta completada queda con esa
  `branchId` y su efectivo entra en la sesión de la caja de esa sucursal, no en
  la abierta en otra.
- Venta y caja en una sucursal activa donde no se trabaja: `400` con «No
  trabajás en esa sucursal o está desactivada: elegí otra o pedí que te
  asignen.» y nada creado.

No se prueba en el navegador el punto de expedición por sucursal (formulario de
edición en Configuración › Sucursales, «Factura con 002-001») ni la numeración
fiscal desde ese punto. Lo cubren las pruebas web de `branches-surface` y las de
la API; `fiscal-settings.spec.ts` y `electronic-credit-note.spec.ts` usan el
punto del perfil fiscal, no el de la sucursal. Queda como cobertura de navegador
pendiente, no como criterio incumplido.

## Cambio de la prueba en memoria

La base en memoria de las pruebas ahora imita el alta real. Cada clínica nace
con «Casa central», y cada miembro creado trabaja en las sucursales activas que
existan en ese momento. Una caja o venta sembrada sin `branchId` va a la primera
sucursal.
