---
id: UX-017
type: story
title: Staff weight entry and correction with explicit kilograms
epic: EPIC-06
status: done
priority: high
depends_on: [VET-004, UX-014, UX-016]
prd_sections: ["9", "12.1", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-017 — Registrar y corregir pesos en kg

ID disponible verificado. Autorizado tras DEC-084 accepted y aclaración del
responsable: no hay base productiva que convertir. Se versiona solo DDL
reproducible, sin backfill/conversión, reset o limpieza. [[Clinical]],
[[DEC-084-weight-measurement-unit]], [[TD-055]], [[TD-066]], [[DEC-080]],
[[ADR-001]].

## Criterios

- [x] Unidad nullable KG en ClinicalWeight, sin default que atribuya kg a datos
      previos. Migración aditiva verificable en DB desechable, sin transformar
      datos.
- [x] POST/PUT admiten unit KG explícita opcional conservando cuerpos/respuestas
      legados. Crear sin unidad guarda desconocida; cambiar cantidad sin unidad
      explícita deja desconocida la nueva cantidad, incluso sobre un KG previo.
      Cambiar solo fecha conserva unidad. Unidad/cantidad/fecha se auditan
      juntos.
- [x] Cantidad positiva exacta NUMERIC(10,3), hasta siete enteros/tres
      decimales, validada en backend también para llamadas al servicio. Sin
      floats, conversión, redondeo silencioso o máximo clínico inventado.
- [x] Lectura staff paginada/detalle expone unit KG/null sin alterar DTOs GET
      anteriores ni Portal. Filtro all/KG/unspecified; rango solo con unidad
      seleccionada. Consumidor anterior con rango sin unit consulta
      desconocidos; sin rango/unit conserva todas las filas, sin comparación
      clínica mezclada.
- [x] Registrar y corregir con revisión/confirmación, fecha Paraguay, coma
      decimal, PUT parcial y preservación de segundos/milisegundos originales al
      cambiar otros campos. Nuevas cargas staff envían KG; confirmar KG de un
      valor desconocido exige checkbox explícito, no una lectura. Fecha sola
      puede corregirse conservando unidad desconocida.
- [x] Guardias de doble envío y respuesta incierta, relectura previa y error
      preservando formulario. Sin retry automático, promesa de CAS/idempotencia
      o recuperación tras desmontaje. Confirmación al cancelar/salir por enlace,
      beforeunload; contexto de lista por paciente conservado al guardar/volver.
- [x] Staff/membresía, tenant del contexto, veterinary y create/update
      existentes backend; aislamiento y auditoría atómica, sin texto/valores
      clínicos en logs. Frontend UX-only, claims conocidos ocultan acciones,
      desconocidos con API autoritativa como patrón actual. Tokens semánticos y
      accesibilidad/es-PY.
- [x] Pruebas HTTP/UI/proxy simuladas, PostgreSQL real desechable de
      DDL/comandos/ auditoría/compatibilidad, lint, tipos y builds aislados; sin
      datos operativos, nueva ronda de navegador/E2E o interrupción de dev.
      Documentación/evidencia separada, TD-055 solo se cierra con estos gates
      aprobados.

## Clasificación y límites

Unidad y cantidad clínicas CONFIDENTIAL, mismas reglas de exposición/retención.
Sin gráfico, derivación de peso actual, libras/gramos, archivos, cambios a otros
registros clínicos o finanzas. Sin dependencias, abstracción genérica,
commit/push. TD-066 se extiende a pesos. PRD §12.1 aprobado no se modifica
silenciosamente. DDL/despliegue de esquema se diferencia de una migración de
datos productivos.

## Implementación y verificación

Implementado y verificado; cambios locales previos conservados. Campos
unit/cantidad CONFIDENTIAL. Migración aditiva
20261030000001_clinical_weight_unit, solo DDL sin default/backfill/conversión,
probada exclusivamente en bases desechables.

POST/PUT existentes admiten KG opcional; DTOs GET/comandos anteriores intactos.
Proyección staff paginada/detalle unit-aware; rango por unidad, compatibilidad
legada explícita. Formularios y filtros conservan contexto; kg explícito en
nuevas cargas y checkbox para atribuirlo a desconocidos. PUT parcial, auditoría
atómica, precisión exacta, permisos y tenant del contexto. Sin dependencias
nuevas.

275 pruebas distintas aprobadas: API 81, web 157, esquema 15, PostgreSQL
real 22. Lint/tipos API/web y tipos database aprobados. Prisma validate/generate
y builds API/web/database aislados aprobados, con verificación de salida web.
Formato y diff revisados. Evidencia y comandos en
[[UX-017-VALIDATION-2026-10-30]].

TD-055 resuelto por cobertura funcional; TD-066 abierto para concurrencia,
idempotencia, respuesta incierta, borradores y visual/E2E pendiente. Sin
navegador, operaciones sobre datos reales, despliegue de esquema operativo,
commit o push. No se presenta DDL de prueba como conversión de una base
productiva.
