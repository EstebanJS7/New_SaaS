---
id: UX-026
type: story
title: Required preproduction clinical write guards
epic: EPIC-06
status: planned
priority: high
depends_on: [UX-025]
prd_sections: ["13", "27", "28", "41"]
branch: main
created: 2026-10-31
updated: 2026-10-31
---

# UX-026 — Contratos clínicos obligatorios antes de producción

ID libre verificado, DEC-085 revisada y aceptada explícitamente. No comenzar
código hasta cerrar el diagnóstico TD-067; actualizar PRD/in-progress primero.

## Criterios

- [ ] Creación de tratamientos/estudios/pesos exige clave válida y corrección
      exige versión original y motivo, con validación backend y BFF antes de
      efectos. No compatibilidad silenciosa para comandos públicos sin guardias.
- [ ] Consumidores controlados/fixtures/scripts adoptan las guardias; pruebas
      negativas verifican omisiones, valores inválidos y cero efectos. No
      generar claves en transporte/backend ni rebasar intentos enviados.
- [ ] Mantener autorización/tenant/entitlement/404, replay/carreras/auditoría
      única/rollback, historia, recuperación temporal/durable,
      precisión/unidades, formatos y respuesta DTO de peso con relectura
      GET-only.
- [ ] Lint/tipos/tests/builds aislados y PostgreSQL real desechable aprobados;
      regresión E2E clínica correspondiente. No migraciones dev, datos
      operativos, purga/retención nueva, dependencias, commit o push.
- [ ] Actualizar Story/Clinical/TD-066/guía/changelog/QA y PRD explícitamente
      según DEC-085; conservar datos históricos con motivo/unidad no informados.

## Implementación y verificación

Pendiente. No se presume obligatoriedad activa desde el estado accepted de la
decisión; código y verificaciones determinan el comportamiento vigente.
