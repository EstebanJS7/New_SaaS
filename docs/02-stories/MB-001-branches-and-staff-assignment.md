---
id: MB-001
type: story
title: Branches and staff assignment
epic: EPIC-07
status: in-progress
priority: high
depends_on: []
prd_sections: ["§9.1"]
permissions: ["branches.manage"]
branch:
created: 2026-11-03
updated: 2026-11-03
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
  - Drill en PostgreSQL 16: nombre duplicado sin distinguir mayúsculas, nombre
    vacío, borrado rechazado, asignación entre clínicas rechazada, relleno
    correcto.
- Web:
  - Pantalla de sucursales (7).
  - Personal con sucursales (5).
  - Agenda filtra por sucursal.
  - Proxies.
  - Build de Next.
- **Pendiente:** la migración contra una base con datos reales y la prueba en
  navegador. Si una clínica tuviera dos sucursales con el mismo nombre (solo
  posible insertando a mano), la migración falla en el índice único: renombrar
  una antes de migrar.
