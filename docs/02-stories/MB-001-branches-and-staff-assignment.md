---
id: MB-001
type: story
title: Branches and staff assignment
epic: EPIC-07
status: done
priority: high
depends_on: []
prd_sections: ["§9.1"]
permissions: ["branches.manage"]
branch: test/sal-rev-concurrency-mb001
created: 2026-11-03
updated: 2026-11-10
---

# MB-001 — Sucursales y asignación de personal

## Objetivo

Que la clínica administre sus sucursales y decida quién trabaja en cada una, y
que un turno solo pueda darse en una sucursal activa donde trabaja el
profesional. Primera entrega de [[DEC-094]].

## En alcance

- **Base de datos** (`20261106000001_branch_management`):
  - `branch` gana `address`, `phone` e `is_active`; nombre de 1 a 120 caracteres
    y único por clínica sin distinguir mayúsculas; trigger que impide borrar.
  - Tabla `membership_branch` con claves foráneas compuestas por clínica.
  - Relleno: cada membresía existente queda en todas las sucursales de su
    clínica.
- **Permiso** `branches.manage` (Propietario y Administración) en el seed.
- **API** (`BranchesModule`):
  - `GET/POST /branches`, `PUT /branches/:id`,
    `POST /branches/:id/deactivate|reactivate`.
  - `PUT /memberships/:id/branches` reemplaza las sucursales de una persona.
  - Una segunda sucursal activa exige `multi_branch` (403
    `FEATURE_NOT_ENTITLED`).
  - No se desactiva la última sucursal activa ni una con turnos pendientes.
  - No se le quita a alguien una sucursal donde tiene turnos pendientes.
  - Auditoría con ids solamente.
- **Invitaciones:** `branchIds` opcional; si se omite, la persona queda en todas
  las sucursales activas. El alta de clínica asigna al propietario a la sucursal
  inicial; el seed demo asigna a todo el personal a su sucursal.
- **Agenda:**
  - Crear un turno o aprobar una solicitud del portal exige sucursal activa y
    profesional asignado (400 con mensaje en español).
  - `GET /appointments/options` devuelve `isActive` por sucursal y `branchIds`
    por profesional.
- **Web:**
  - Pantalla Configuración › Sucursales.
  - En Personal, las sucursales de cada persona, un editor por persona y la
    elección en la invitación (solo si hay más de una sucursal).
  - En la agenda, el formulario de turno y la aprobación ofrecen solo sucursales
    activas y los profesionales de la sucursal elegida.
  - Proxies con lista de rutas permitidas `/api/branches` y
    `PUT /api/memberships/:id/branches`.

## Fuera de alcance (siguientes entregas)

- Cajas, ventas y establecimiento fiscal por sucursal (MB-002).
- Stock por sucursal y transferencias (MB-003).
- Filtro por sucursal en reportes (MB-004).
- La oferta de horarios del portal todavía no mira la asignación: el portal no
  elige sucursal y la aprobación del personal sí la exige.

## Cierre de verificación (2026-11-10)

Rama `test/sal-rev-concurrency-mb001`: build 17/17; lint, format-check y
typecheck pasan después de reparar dependencias locales con autorización.
PostgreSQL: 277/277 casos de aislamiento/aplicación. El primer recorrido
completo falló solo en el tripwire p95 de reportes (9580 ms > 8000 ms) mientras
corrían otras verificaciones; el mismo archivo, sin esas cargas, pasó 6/6. No se
cambiaron umbrales, aserciones ni código de reportes. Navegador afectado:
sucursales, anulación y nota de crédito electrónica, 3/3. Suites unitarias
completas API/web y CI remoto quedan a cargo del CI, según el usuario.

Risk: none (pruebas y documentación de comportamiento ya implementado; no se
modificaron migraciones, servicios ni helpers compartidos).

## Verificación

- API:
  - `branches.service.test.ts` (17).
  - Invitaciones con sucursales.
  - Turnos: profesional no asignado y sucursal desactivada.
  - Opciones de agenda.
  - Probe de rutas: las 6 rutas declaran `branches.manage`.
  - Aislamiento: 403 sin el permiso; sin lectura individual ni borrado.
- Base de datos:
  - Seed: 69 permisos.
  - Alta: asignación del propietario.
  - Seed demo: asignaciones idempotentes.
  - Drill histórico reproducible en PostgreSQL 16
    (`scripts/verify-branch-migration.mjs`): 60 migraciones anteriores a MB-001,
    datos sembrados antes de MB-001 y después MB-001..MB-003. Comprueba la
    asignación de todo el personal a todas las sucursales previas, el backfill
    de caja, ventas y stock a la sucursal más antigua, las dos sucursales de
    respaldo («Casa central») para clínicas sin sucursal, la preservación exacta
    de filas e importes y cero huérfanos.
  - Drill en PostgreSQL 16: nombre duplicado sin distinguir mayúsculas, nombre
    vacío, borrado rechazado, asignación entre clínicas rechazada, relleno
    correcto.
- Web:
  - Pantalla de sucursales (7).
  - Personal con sucursales (5).
  - Agenda filtra por sucursal.
  - Proxies.
  - Build de Next.
  - Prueba en navegador: `apps/e2e/specs/branches.spec.ts` (ver abajo).
- **Riesgo:** si una clínica tuviera dos sucursales con el mismo nombre (solo
  posible insertando a mano), la migración falla en el índice único: renombrar
  una antes de migrar.

## Prueba en navegador

`apps/e2e/specs/branches.spec.ts` recorre las pantallas reales contra el tenant
demo y los servicios de la lane: crea una sucursal en Configuración ›
Sucursales, asigna al veterinario y al propietario en Personal, y comprueba cada
restricción contra la API y contra la superficie que muestra el rechazo.

| Paso                           | Qué se observa                                                                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Última sucursal activa         | Con una sola sucursal activa la pantalla no ofrece «Desactivar»; `POST /branches/:id/deactivate` responde `409 CONFLICT` «Tiene que quedar al menos una sucursal activa.» y la sucursal sigue activa.                                                |
| Sucursal con turnos pendientes | Un turno en la sucursal nueva hace que el diálogo muestre «La sucursal tiene 1 turno pendiente: reprogramalo o cancelalo antes de desactivarla.»; la API responde lo mismo, la sucursal sigue activa y el turno sigue `SCHEDULED`.                   |
| Personal con turnos pendientes | Quitarle esa sucursal a la profesional se rechaza con «Esa persona tiene 1 turno pendiente en una sucursal que le quitás: reasignalo antes.» y la asignación no cambia.                                                                              |
| Sucursal de trabajo            | Antes de asignar, crear una venta o una caja en la sucursal nueva responde `400 VALIDATION_FAILED` «No trabajás en esa sucursal o está desactivada…» sin crear nada. Después de asignar al propietario, Caja y Mostrador ofrecen elegir la sucursal. |
| Caja y venta                   | La caja creada queda en la sucursal elegida (`branchId`/`branchName`); la venta cobrada en efectivo queda con ese `branchId` y su movimiento `SALE` aparece en la sesión de esa caja.                                                                |

**Evidencia observada (2026-11-10):** la lane pasó 1 test con `pnpm build` y
Playwright sobre los servicios de `newsaas-e2e-*`. El nombre de la sucursal, la
caja y el turno llevan un tag por corrida; la limpieza devuelve al tenant a una
sucursal activa y una sola sucursal de trabajo, y una corrida interrumpida se
limpia al empezar la siguiente.

## Drill de migración con datos

El drill corre sobre una base desechable y no toca migraciones ni código de
producto. `prisma migrate deploy` no puede detenerse en una migración, así que
el script deriva un árbol temporal solo con las migraciones anteriores a
`20261106000001_branch_management`, siembra datos históricos por SQL y aplica el
resto sobre la misma base.

Cómo se corre, contra un PostgreSQL desechable en loopback:

```bash
DATABASE_URL_TEST='postgresql://postgres@127.0.0.1:55432/postgres?schema=public' \
  node scripts/verify-branch-migration.mjs
```

El script exige `DATABASE_URL_TEST`, rechaza hosts que no sean de loopback y no
usa `DATABASE_URL`. Crea su propia base `newsaas_branch_drill_*`, la elimina al
final con `DROP DATABASE ... WITH (FORCE)` y borra su árbol temporal. Si falla,
termina con código distinto de cero y deja el error concreto.

| Caso sembrado                                                              | Qué prueba                                                                                               |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Clínica A: una sucursal, dos personas                                      | Cada miembro queda en todas las sucursales previas (no solo en la más antigua).                          |
| Clínica B: sucursal antigua y nueva, dos personas                          | Caja, ventas y stock van a la más antigua; un turno en la nueva conserva su sucursal (el FK ya existía). |
| Clínica C: caja y ventas, sin sucursal (solo por SQL)                      | MB-002 crea «Casa central» y reubica caja y ventas; MB-003 no interviene.                                |
| Clínica D: stock, sin sucursal (solo por SQL)                              | MB-003 crea «Casa central» y reubica movimientos y saldo.                                                |
| Caja, sesión, movimiento, venta completada con pago, línea, stock y turnos | Los ids originales y los importes sobreviven; ninguna fila queda con `branch_id` nulo o de otra clínica. |

Las clínicas C y D existen solo para el fallback de filas insertadas a mano; no
tienen personal, así que el backfill de MB-001 no les crea asignaciones. El
drill también comprueba que la etapa histórica no tiene columnas de
MB-001/MB-002 y que el segundo deploy aplica todas las migraciones restantes,
incluidas MB-001, MB-002 y MB-003.

**Evidencia observada (2026-11-10):** la corrida con el comando de arriba pasó
con 9 líneas `ok`, incluida la preservación exacta de importes (caja 170,00;
sesiones 70,00; líneas y pagos 200,00; stock 13,000/23,000) y cero huérfanos.

**Riesgo:** el drill usa datos representativos, no una copia de producción. Una
anomalía real no sembrada —por ejemplo, dos sucursales homónimas insertadas a
mano— sigue fallando en el índice único y debe resolverse antes de migrar. No se
siembran compras: el backfill de `purchase.branch_id` usa la misma consulta de
sucursal más antigua que stock, pero no está ejercitado con datos.
