---
id: UX-033
type: story
title: Spanish cash forms and exact local input
epic: EPIC-13
status: done
priority: medium
depends_on: [CASH-004, UX-032]
prd_sections: ["20", "29", "41"]
branch: main
created: 2026-11-02
updated: 2026-11-02
---

# UX-033 — Formularios y mensajes de Caja

Continuación autorizada. Aplicar DEC-080 a la UI existente sin ampliar PRD.

## Criterios

- [x] Etiquetas, ayudas, estados, resultados y errores de Caja en español;
      respuestas privadas desconocidas no se muestran. Clasificadores conservan
      códigos y mensajes wire existentes. Fechas UTC no cambian en esta etapa.
- [x] Apertura, movimiento y conteo aceptan es-PY y normalizan por texto al wire
      Decimal(14,2), sin Number/redondeo. Cero permitido al abrir/contar, prohibido
      en movimientos; escala, rango, motivo y dirección mantienen reglas.
- [x] Revisar y confirmar apertura, movimiento y cierre en modal existente,
      cancelar sin comando/clave nueva, pendiente sin doble confirmación y error
      seguro sin éxito supuesto. Clave de movimiento se conserva tras rechazo.
- [x] Preservar cuerpos wire, idempotencia, permisos, tenant, ledger, auditoría
      y backend. No efectos por abrir revisión o cambiar selección.
- [x] Pruebas dirigidas Caja/BFF/helper y regresión pertinente, lint/tipos/formato
      aprobados; documentar gates simuladas y límites sin Playwright/PG nuevo.
- [x] Story, Cash, continuidad, changelog y QA actualizados.

## Límites

No nuevos endpoints, migraciones, permisos, dependencias, monedas o cálculos.
No conversión de fechas sin zona autoritativa, cierre/reapertura automáticos,
recuperación durable o nuevo protocolo de idempotencia. Datos CONFIDENTIAL solo
en estado local; sin URL/logs/storage nuevos. No borrar historial, recibos o
movimientos. No alterar clínica, POS, Portal u otros módulos. Revisar flujo con
componentes y contratos actuales; navegador/PG/build nuevos solo si hay un riesgo
concreto que esas pruebas no cubran. Sin commit/push o CI remota asumida.


## Cierre — 2026-11-02

UI de Caja localizada, entradas es-PY normalizadas por texto al wire vigente y
revisión explícita en apertura/movimiento/cierre con modal existente. Errores
privados sanitizados; constantes de clasificación wire intactas. Identidad React
de paneles diferenciada sin modificar el remonte por sesión. Sin nuevos campos,
endpoints, permisos, migraciones, dependencias o cambios PRD/backend.

201 casos distintos aprobados en12 archivos; selección197/201 seguida de
correcciones dirigidas y47/47 en los cuatro archivos afectados. Tipos web, lint
dirigido, formato y diff-check aprobados. Simulación de UI/BFF, sin nueva lane
PostgreSQL, Playwright, revisión visual o build. Foco en jsdom no es auditoría
nativa. Evidencia/fallos en [[UX-033-VALIDATION-2026-11-02]].

Fechas y continuidad de intentos inciertos/durables siguen pendientes, la última
registrada por inspección estática en TD-073. No afirmar todo Caja/UI V1 completo
ni CI remota. Módulo, continuidad y changelog sincronizados, trabajo anterior
preservado. Sin commit/push o despliegue.
