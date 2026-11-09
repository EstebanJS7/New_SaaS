---
id: UX-035
type: story
title: Recoverable sale creation and cash attempts
epic: EPIC-12
status: in-progress
priority: high
depends_on: [UX-031, UX-034]
prd_sections: ["§18", "§19", "§20"]
permissions:
  [sales.create, sales.read, cash.session.open, cash.movement.create, cash.read]
branch:
created: 2026-11-03
updated: 2026-11-09
---

# UX-035 — Intentos recuperables en POS y Caja

## Objetivo

Que una venta, una apertura de caja o un movimiento cuya respuesta se perdió se
puedan identificar con certeza, incluso tras recargar la página, sin reenviar a
ciegas ni comparar valores. Cierra [[TD-071]] y [[TD-073]] con los límites de
[[DEC-092]].

## En alcance

- API: `Idempotency-Key` opcional en `POST /sales` (registro `sale.create`) y
  `POST /cash/sessions` (id derivado); consultas `GET /sales/attempts/:key`,
  `GET /cash/sessions/attempts/:key` y `GET /cash/movements/attempts/:key`.
- Proxy web: reenvía la clave y sirve las consultas solo por `GET` y con UUID.
- Web: `lib/pending-attempts` (solo clave, tipo y hora en `sessionStorage`); POS
  con «Consultar si se creó» y «Reintentar» con la misma clave; Caja con
  «Consultar si se abrió» y «Reintentar la misma apertura»; paneles de intentos
  de una página anterior en POS y Caja.

## Criterios de aceptación

- [x] La misma clave y cuerpo repiten el borrador o la sesión (`200`), sin
      segundo registro ni segunda auditoría; otro cuerpo, `409`.
- [x] Sin clave, crear una venta y abrir una sesión se comportan como antes.
- [x] Las consultas por clave devuelven lo registrado o `404`, y nunca lo de
      otro tenant.
- [x] El navegador guarda solo clave, tipo y hora; nunca contenido comercial.
- [x] Ningún reenvío automático: consultar y reintentar son acciones explícitas,
      y el reintento usa la misma clave.
- [x] Tras recargar, POS y Caja ofrecen consultar los intentos pendientes.
- [x] Respuesta perdida reproducida contra PostgreSQL y navegador (live-pg
      40fcb89; `apps/e2e/specs/recoverable-attempts.spec.ts`: venta con
      respuesta perdida y recarga, venta que no llegó y reintento, apertura de
      caja con respuesta perdida y recarga).

## Verificación

```text
2026-11-03 (sandbox):
  api: 2007 OK (2 fallas PREEXISTENTES del inventario de rutas clínicas); nuevos:
    venta con clave (replay, 409, consulta, aislamiento), sin clave sin cambios,
    apertura con clave (replay, 409, consulta), consulta de movimiento por clave
  web: 2167 OK (22 fallas PREEXISTENTES: dashboard, compras, proveedores,
    surface-integrity); nuevos en POS 3, Caja 3, proxy 4, pending-attempts 4;
    next build OK
No se pudo correr: PostgreSQL real de punta a punta y navegador.

2026-11-09 (PostgreSQL 16 real, suite live-pg, bloque SAL-REV-001/UX-035):
  venta con clave: 201, consulta por clave tras "perder" la respuesta, replay 200
    con el mismo id, otro cuerpo 409; una venta, una auditoría sale.created y un
    registro sale.create
  apertura con clave: 201, consulta, replay 200, otro importe 409; una sesión y
    una auditoría cash.session.opened
  movimiento con clave: consulta por clave devuelve el mismo movimiento
  otro tenant: 404 en las tres consultas; clave desconocida: 404
  pnpm test:live-pg completo: 276/276
Navegador cubierto el 2026-11-09 por specs/recoverable-attempts.spec.ts (3 casos).
```

## Decisiones / ADRs

- [[DEC-092]]
