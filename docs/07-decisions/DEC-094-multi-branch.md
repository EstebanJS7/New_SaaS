---
id: DEC-094
type: decision
title: Multi-branch operation (branches, staff assignment, cash, stock and reports)
status: accepted
date: 2026-11-03
related_epics: [EPIC-07, EPIC-10, EPIC-12, EPIC-13, EPIC-18]
related_stories: [MB-001, MB-002, MB-003, MB-004]
supersedes_in_part: [DEC-020, DEC-062]
resolves: [TD-052]
prd_change_required: false
---

# DEC-094 — Operación con varias sucursales

## Contexto

El 02/11 se decidió salir a producción con multi-sucursal (plan, Fase 0). Hasta
hoy `Branch` existe solo como ancla de los turnos: nadie la crea fuera del alta
de la clínica, no tiene estado y nada que mueva dinero o stock la referencia
([[TD-052]]). [[DEC-020]] dejó la caja a nivel de clínica a propósito y
[[DEC-062]] declaró que los reportes no tienen corte por sucursal.

## Decisiones

1. **Una sucursal es un lugar físico** donde se atiende, se cobra y se guarda
   stock. Cada sucursal tiene **un solo depósito**, el suyo: no se crea una
   entidad «depósito» aparte.
2. **Datos de una sucursal:** nombre (1 a 120 caracteres, único por clínica sin
   distinguir mayúsculas), dirección y teléfono opcionales, y estado activa o
   inactiva. Una sucursal **nunca se borra**: se desactiva, y lo histórico
   (turnos, ventas, movimientos) conserva su referencia. Siempre queda al menos
   una sucursal activa.
3. **Plan:** la clínica puede tener una sucursal activa sin más. Tener **dos o
   más activas** requiere la capacidad `multi_branch` (ya sembrada). Desactivar
   nunca la requiere.
4. **Permiso nuevo `branches.manage`**, solo para Propietario y Administración:
   crear, editar, desactivar y reactivar sucursales y asignar personal.
5. **Asignación de personal:** cada miembro del personal está asignado a una o
   más sucursales (relación muchos a muchos). La asignación decide **dónde
   trabaja**, no qué puede ver:
   - un profesional solo puede tener turnos (del personal o del portal) en las
     sucursales a las que está asignado;
   - desde MB-002, un cajero solo abre caja y cobra en cajas de sus sucursales;
   - la lectura no se restringe: clientes, pacientes e historia clínica son de
     la clínica, y los listados con corte por sucursal muestran **«Todas»** por
     defecto, para que los números no cambien para quien no lo pidió.
6. **Invitaciones:** si no se eligen sucursales, la persona invitada queda
   asignada a todas las sucursales activas. El alta de la clínica asigna al
   propietario a la sucursal inicial.
7. **Sucursal inactiva:** no admite turnos nuevos ni (desde MB-002) aperturas de
   caja ni ventas nuevas. Lo ya registrado no cambia.
8. **Datos existentes, sin adivinar:** hasta hoy toda clínica operó con una
   sola sucursal real, así que:
   - toda membresía existente queda asignada a todas las sucursales existentes;
   - en MB-002 y MB-003, cajas, ventas, compras y stock existentes pasan a la
     sucursal **más antigua** de la clínica (la que creó el alta).
9. **Caja y ventas (MB-002), reemplaza a DEC-020 en este punto:** cada caja
   pertenece a una sucursal. Una venta se crea en una sucursal y solo se cobra
   con una sesión abierta de una caja de esa sucursal. Cada sucursal puede
   vincularse a un establecimiento fiscal y punto de expedición: las facturas
   de sus ventas se numeran allí, y sin vínculo se usa el punto por defecto del
   perfil fiscal.
10. **Stock (MB-003):** el saldo es por (ítem, sucursal). Cada movimiento lleva
    su sucursal; una compra se recibe en una sucursal; las transferencias entre
    sucursales son un par de movimientos (salida y entrada) con el permiso ya
    sembrado `inventory.stock.transfer`.
11. **Reportes (MB-004), reemplaza a DEC-062 en este punto:** los reportes
    comerciales, de caja, compras e inventario aceptan un filtro de sucursal
    opcional («Todas» por defecto). La agenda ya filtra por sucursal.

## Entregas

| Historia | Alcance |
| --- | --- |
| MB-001 | Sucursales (alta, edición, activar/desactivar) y asignación de personal; turnos solo en sucursales asignadas |
| MB-002 | Cajas y ventas por sucursal; establecimiento fiscal por sucursal |
| MB-003 | Stock por sucursal, compras y transferencias |
| MB-004 | Filtro por sucursal en reportes |

## Estado

- 2026-11-03: MB-001 y MB-002 entregadas.
- 2026-11-04: MB-003 entregada. Hasta MB-004, el informe de stock suma todas
  las sucursales y las transferencias no cuentan como entrada ni salida de la
  clínica.
- 2026-11-05: MB-004 entregada. Con ella se completa esta decisión y se cierra
  [[TD-052]]. Filtrado por sucursal, un movimiento de transferencia es entrada
  o salida real de esa sucursal; en «Todas» sigue sin contar.
- En MB-002 la regla «una sola sesión abierta» pasó a ser por sucursal: el
  efectivo de una venta va a la única sesión abierta de una caja de su
  sucursal.

## Consecuencias

- `TD-052` se cierra al terminar MB-004.
- La prueba que fijaba que `Branch` no tenía rutas
  (`cross-tenant-isolation.e2e-spec.ts`) se reemplaza por pruebas de
  aislamiento de las rutas nuevas.
