---
id: UX-018
type: story
title: Temporary recovery of specialized clinical record forms
epic: EPIC-06
status: done
priority: high
depends_on: [UX-015, UX-016, UX-017, UX-007]
prd_sections: ["9", "12", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-018 — Recuperación temporal de formularios clínicos

ID disponible verificado. Usuario aprobó continuar con la recuperación propuesta
para tratamientos, estudios y pesos. [[TD-065]] aporta el precedente de memoria
por documento; [[TD-066]] conserva concurrencia/idempotencia y QA visual
pendiente. [[Clinical]], [[ADR-001]], [[DEC-080]], [[UX-007]].

## Criterios

- [x] Retener una copia por paciente y tipo al desmontar con cambios, durante
      diez minutos en QueryClient del documento; baseline y campos exactos,
      incluidos vacíos, fecha local y confirmación KG. Sin Storage/URL/logs,
      nuevas dependencias, store global, backend o migración.
- [x] Al volver, lectura fresca autorizada antes de ofrecer recuperar/descartar.
      No restaurar ni escribir automáticamente. Recuperación de corrección relee
      detalle y rechaza baseline cambiado; errores temporales permiten
      reintentar. 401/403/404 descartan copia y no exponen contenido. Claims
      conocidos restringen create/update; backend mantiene autoridad al guardar.
- [x] Recuperar requiere revisión/confirmación normal antes de escribir,
      preserva contexto de lista y precisión del baseline, no cambia unidades ni
      aplica contenido a otros pacientes/tipos/documentos.
- [x] Guardar o descartar explícitamente elimina copia; formulario limpio no
      genera borrador. Expiración elimina copia, logout/reingreso/recarga no la
      recuperan. Enlaces conservan advertencias y descarte aceptado es
      definitivo.
- [x] Guardado en vuelo al salir se marca pendiente y no se puede reenviar.
      Éxito tardío limpia solo su copia e invalida lecturas; respuesta incierta
      conserva copia bloqueada para consultar/revisar manualmente, sin retry ni
      deducir éxito por coincidencia de campos. No prometer idempotencia o CAS.
- [x] Pruebas automatizadas dirigidas de recuperación, expiración, aislamiento,
      permisos, conflictos, descartes y resultados tardíos; regresión de los
      tres formularios/listados y sesión/consulta. Lint/tipos web y build
      aislado con verificador de salida. Sin nueva ronda de navegador/E2E,
      PostgreSQL o mutaciones operativas para esta etapa exclusivamente
      frontend.
- [x] Actualizar módulo, TD-066, guía UX/UI, changelog y evidencia QA, separando
      simulación de validación visual/DB no ejecutada. Sin commit/push o cambios
      de PRD; cambios locales acumulados conservados.

## Clasificación y límites

Borradores y baseline CONFIDENTIAL. Copia efímera de trabajo, no historia
clínica persistida ni autosave. Lógica específica de tres registros Veterinary,
no un framework compartido Core. Concurrencia transaccional, idempotencia de
comandos, recuperación durable/cruzando sesiones, vacunas y consultas existentes
fuera de alcance. TD-066 sigue abierto para esos límites y visual/E2E.

## Implementación y verificación

Implementado: clinical-record-recovery.ts y panel específico Veterinary,
integrado a los tres formularios y listados. Copias tipadas por paciente/tipo;
lectura fresca antes de ofrecer/recuperar, baseline completo para correcciones,
confirmación explícita y borrado por éxito/descarte/expiración/denegación.
Resultados tardíos asociados a token, sin borrar una copia nueva ni repetir
comandos pendientes/inciertos. Campo vacío, multilínea, fecha/instante y unidad
preservados. Sin API, migración, dependencia o cambios de PRD.

233 pruebas distintas simuladas aprobadas; lint/tipos web y build aislado con
verificador de salida. Comandos, hallazgos y límites en
[[UX-018-VALIDATION-2026-10-30]]. Sin PostgreSQL, navegador/E2E, datos
operativos, commit o push. Módulo, guía UX/UI, changelog y TD-066 actualizados;
esta deuda permanece abierta para concurrencia, idempotencia y validación visual
pendiente.
