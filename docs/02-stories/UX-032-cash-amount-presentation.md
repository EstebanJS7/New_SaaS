---
id: UX-032
type: story
title: Exact es-PY cash amount presentation
epic: EPIC-13
status: done
priority: medium
depends_on: [CASH-004]
prd_sections: ["20", "29", "41"]
branch: main
created: 2026-11-01
updated: 2026-11-01
---

# UX-032 — Presentación de importes y diferencias de Caja

Primera mejora acotada de Caja, conforme a DEC-080 aceptada. Usar el formateador
es-PY existente en importes de lectura y diferencias con signo. No ampliar PRD.

## Criterios

- [x] Presentación exacta es-PY, sin Number, redondeo o conversión de moneda.
      Diferencia positiva/negativa conserva signo y cero no inventa faltante.
      Valores no reconocidos conservan fallback. Descripción de diferencia en español.
- [x] Mantener comandos, validación/entrada editable, wire Decimal, idempotencia,
      autorización, ledger y clasificación de resultados intactos.
- [x] Pruebas existentes de Caja y BFF, regresión de consumidores afectados,
      lint/tipos/formato aprobados. Verificación dirigida; sin nueva lane de
      navegador/PG o build por este cambio de presentación sin rutas/dependencias.
- [x] Módulo, continuidad, changelog y QA registran evidencia y límites.

## Límites

No traducción integral de Caja. Formularios, entrada decimal, estados y fechas
son etapa posterior: no convertir timestamps a fecha local sin resolver la zona
autoritativa del tenant. No comandos, campos, endpoints, migraciones, deps,
datos operativos, browser storage/logs o PRD nuevos. Datos CONFIDENTIAL sin
persistencia adicional. No afirmar verificación visual, PostgreSQL o build nuevos.
Conservar trabajo acumulado; sin commit/push.


## Cierre — 2026-11-01

Solo cash-display.ts cambia en producto: reutiliza helper es-PY existente y
localiza la descripción de diferencia; clasificación/signos inalterados. Cinco
archivos de pruebas actualizan únicamente presentación. Wire y fixtures intactos.
190 casos distintos aprobados en11 archivos (Caja/BFF/formateador compartido).
Primera selección189/190; faltaba una aserción de250.00→250 en pantalla. Recheck
MovementPanel26/26,salida0,13,98s. No se suman casos repetidos. Lint dirigido,
tipos web, formato y diff-check aprobados. Sin nueva lane PG, navegador, revisión
visual o build para este cambio de presentación. QA registra advertencias
existentes de keys duplicadas de mocks sin ocultarlas. No certificar Caja
integralmente traducida; fechas/inputs/estados y demás formularios pendientes.
Módulo, continuidad y changelog sincronizados. No nuevos campos, datos, permisos,
endpoints, migraciones o dependencias, commit/push, despliegue o CI remota.
Ver [[UX-032-VALIDATION-2026-11-01]].
