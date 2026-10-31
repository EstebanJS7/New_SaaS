---
id: UX-023
type: story
title: Immutable history of specialized clinical corrections
epic: EPIC-06
status: done
priority: high
depends_on: [UX-019, UX-020, UX-021, UX-022]
prd_sections: ["12.1", "13", "27", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-023 — Historial de correcciones clínicas

ID disponible verificado. Story iniciada tras aceptación explícita de las
opciones 1/1/1 de motivo, permiso y presentación, para implementar
[[DEC-086-specialized-clinical-correction-history]], aceptada el 2026-10-30. PRD
se actualiza explícitamente con esa decisión. No confundir con el corte público
propuesto en DEC-085.

## Criterios

- [x] Historial específico e inmutable de correcciones futuras de tratamientos,
      estudios y pesos, con estado anterior/posterior, versiones, actor e
      instante; precisión/unidad/fechas originales sin inferencias.
- [x] Registro, revisión y auditoría atómicos bajo lock scoped; CAS vigente,
      corrección legada capturada, rollback íntegro, conflicto/denegación/no-op
      vacío sin revisión. Replay de creación no duplica historial o auditoría.
- [x] Aplicar las opciones de motivo, permiso y presentación aceptadas en
      DEC-086; documentar explícitamente el límite de omisión en clientes
      legados y la cobertura desde la activación, sin historia inventada.
- [x] Consulta staff paginada, tenant/paciente/tipo, 404 cross-tenant, DTOs y
      entitlement/permisos backend; sin Portal, edición/restauración/borrado o
      exportación de revisiones.
- [x] Preservar contratos de comando, guardias/reintentos/recuperación de
      UX-018–022, pesos legados y formatos es-PY; sin storage/log/URL de
      contenido o nueva retención destructiva. Clasificación CONFIDENTIAL.
- [x] Migraciones y pruebas exclusivamente en PG desechable para atomicidad,
      carreras, inmutabilidad, aislamiento y permisos; regresión API/proxy/UI,
      lint/tipos/builds aislados y verificación visual/E2E acotada del flujo
      nuevo.
- [x] Sin dependencias, datos operativos, commit/push o cambios de otros
      dominios. Actualizar Clinical, TD-066, guía, changelog y QA con límites
      separados.

## Preferencias aceptadas e implementación

Usuario eligió 1/1/1: motivo obligatorio en formulario nuevo, permiso específico
inicial para OWNER/ADMIN/VETERINARIAN, vista por registro. Clave técnica
vet.clinical.history_read respeta domain.resource.action; no cambia los lectores
aprobados. DEC-086 accepted y PRD §§13.2/27 actualizados explícitamente.

Migración 20261030000004_clinical_correction_history: tres tablas tipadas con FK
compuesta tenant/paciente/registro, versiones anterior/nueva únicas por
registro, snapshots completos, actor/identidad descriptiva histórica, motivo e
instante. Triggers AFTER UPDATE capturan OLD/NEW bajo el lock del UPDATE y
protección DB contra UPDATE/DELETE de revisiones. No backfill, conversión o
purga.

Comando servidor fija actor/motivo/ID de revisión mediante set_config local a
transacción; auditoría conserva solo ID/campos y revisionId, sin payload
clínico. Antes de auditar, confirma revisión/alcance/versión en la misma
transacción; captura ausente falla y revierte fila/versión/auditoría. Registro,
revisión y auditoría comparten commit/rollback. SQL directo sin contexto
conserva datos con actor/motivo no informados, sin inventar auditoría de
aplicación. Contexto no se filtra al siguiente comando/pool.

GET .../clinical/history-access devuelve solo capacidad allowed para el paciente
con read/veterinary/tenant. Fue necesario porque la ficha real no entrega
permisos a los listados; desconocido no se interpreta como denegado ni
concedido. POST .../clinical/{treatments|studies|weights}/:id/history/search
exige read y history_read en backend, body beforeVersion opcional, 20
filas/cursor estable por versión, private/no-store y DTO allowlisted. BFF cookie
staff/allowlist y Signal de lectura, sin contenido en query/URL.

PUT agrega correctionReason opcional validado 1..2000, no vacío/solo espacios;
clientes anteriores siguen funcionando con Sin motivo informado. UI exige el
motivo, lo muestra al revisar y lo recupera en la copia temporal UX-018.
Corrección incierta no se reintenta. Versiones y motivos no reemplazan permiso o
contexto; crear con clave UX-019 y peso confirmado GET-only intactos.

Detalle muestra Ver historial tras comprobar acceso; solo lectura antes/después,
actor/motivo, cantidades exactas/unidad explícita y fecha clínica separada de
fecha de corrección, con segundos/milisegundos en es-PY/Paraguay. Paginación con
foco y mensaje de cobertura desde activación; sin restauración/exportación.

## Verificación

359 casos web/proxy, 131 backend simulados, 45 database/esquema, 72 PostgreSQL
real y 17 navegador real aprobados: 624 casos distintos, sin sumar rondas. Seis
capturas nuevas de historial desktop/móvil inspeccionadas. Lint API/web/ e2e y
database aprobado (12 warnings previos de console en scripts sin cambios), tipos
y builds API/database/web aislados, Prisma validate/generate aislados y
verificador Next aprobados. Solo bases/contenedores desechables, sin cliente
generado/dist dev reemplazado. Ver [[UX-023-VALIDATION-2026-10-30]].

Primer browser encontró una integración real pendiente de permisos (entrada
oculta); corregida con capacidad backend y tests, segunda ronda 17/17 en 1,1 min
sin retries. No se presenta el fallo inicial como verde ni se reutilizan pruebas
UX-021 como evidencia de esta UI nueva. Sin nuevos paquetes, datos operativos,
commit/push o cambios de consultas cerradas/otros módulos clínicos. TD-066 sigue
open para corte global DEC-085 (proposed) y recuperación durable.
