---
id: DEC-097
type: decision
title: Explicit catalog unit required by fiscal issuance
status: accepted
date: 2026-11-09
related_epics: [EPIC-16]
related_stories: [FISC-019, FISC-020, NCE-001]
prd_change_required: false
---

# DEC-097 — Unidad de medida fiscal del artículo

## Recomendación

Agregar la declaración opcional `unitOfMeasureCode` en las superficies actuales
de alta/edición/detalle de artículos de catálogo, con un selector mínimo y
validación del catálogo SIFEN ya implementado. No inventar una unidad por defecto
ni modificar artículos existentes para acomodar una prueba.

**Aceptada el 2026-11-09.** El usuario respondió «conytinuemos» a la
propuesta explícita de agregar este campo opcional en API, formulario y pruebas,
sin migraciones ni valores predeterminados. Amplía las dos declaraciones
concretas que DEC-096 había autorizado.

## Evidencia y causa

`packages/fiscal-persistence/src/invoice-snapshot.read.ts:339-347` rechaza toda
línea cuyo `catalog_item.unit_of_measure_code` sea null con
`ITEM_UNIT_NOT_DECLARED`. La columna y el catálogo de unidades ya existen, pero
`apps/api/src/catalog/catalog.zod.ts` y `catalog.service.ts` no ofrecen ningún
escritor público. El campo no tiene un valor por defecto en la base de datos.

La exploración inicial de DEC-096 omitió este prerrequisito. Una segunda
comprobación acotada del ensamblado completo identificó esta unidad como la
última declaración sin escritor público: las restantes entradas pueden
configurarse por las rutas existentes y las dos nuevas de FISC-020.

## Opciones

| Opción | Alcance y consecuencia |
| --- | --- |
| A — Agregar la declaración de unidad (recomendada) | Ampliar FISC-020 con el campo opcional en API, proxy/formulario/detalle de catálogo y pruebas. Reutilizar permisos y catálogo SIFEN existentes, preservar omisión/null y aislamiento tenant, sin migraciones ni nuevas dependencias. Permite continuar el gate NCE-001 sin SQL. |
| B — No ampliar | Conservar el trabajo autorizado de certificado/CSC y DEC-096, pero dejar explícitamente pendientes el gate de navegador y el cierre de las Stories que lo requieren. No usar SQL, un valor implícito ni una aprobación fabricada como sustituto. |

## Límites

No es un sistema nuevo de unidades, una conversión de cantidades, una migración
de artículos, un rediseño del catálogo ni un cambio de cálculos de inventario.
La selección pertenece al dato fiscal que el modelo ya exige. El PRD no cambia.
No autoriza push, PR ni modificación de registros existentes fuera de pruebas
sobre estado aislado.
