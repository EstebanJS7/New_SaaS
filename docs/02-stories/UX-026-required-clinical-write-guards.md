---
id: UX-026
type: story
title: Required preproduction clinical write guards
epic: EPIC-06
status: done
priority: high
depends_on: [UX-025]
prd_sections: ["13", "27", "28", "41"]
branch: main
created: 2026-10-31
updated: 2026-10-31
---

# UX-026 — Contratos clínicos obligatorios antes de producción

ID libre verificado, DEC-085 revisada y aceptada explícitamente. TD-067 resuelta
para su matriz por UX-025; PRD §13.4 e in-progress actualizados antes del
código.

## Criterios

- [x] Creación de tratamientos/estudios/pesos exige clave válida y corrección
      exige versión original y motivo, con validación backend y BFF antes de
      efectos. No compatibilidad silenciosa para comandos públicos sin guardias.
- [x] Consumidores controlados/fixtures/scripts adoptan las guardias; pruebas
      negativas verifican omisiones, valores inválidos y cero efectos. No
      generar claves en transporte/backend ni rebasar intentos enviados.
- [x] Mantener autorización/tenant/entitlement/404, replay/carreras/auditoría
      única/rollback, historia, recuperación temporal/durable,
      precisión/unidades, formatos y respuesta DTO de peso con relectura
      GET-only.
- [x] Lint/tipos/tests/builds aislados y PostgreSQL real desechable aprobados;
      regresión E2E clínica correspondiente. No migraciones dev, datos
      operativos, purga/retención nueva, dependencias, commit o push.
- [x] Actualizar Story/Clinical/TD-066/guía/changelog/QA y PRD explícitamente
      según DEC-085; conservar datos históricos con motivo/unidad no informados.

## Implementación y verificación

API: esquemas strict exigen UUID en POST y versión entera original/motivo no
vacío hasta 2000 en PUT. Servicios de aplicación exigen también esos campos en
tipos y runtime, sin la rama de creación sin recibo ni corrección especializada
sin CAS. Validación previa a escritura/transacción de efectos; auth/tenant y
permisos siguen autoritativos. BFF valida guardias directas y comandos anidados
de submit antes de upstream, conserva bytes/cookies/no-store sin crear claves.

Consumidores staff ya protegidos; sin cambio de formularios/recuperación o DTO.
Comandos sintéticos de pruebas actualizados con claves propias y baselines
explícitos, incluidos escritores remotos E2E. Datos demo/reference preparados
con Prisma directamente son fixtures, no comandos de aplicación; no se les
inventan recibos o actores. Nueva lane scripts/verify-clinical-guards.mjs usa
exclusivamente contenedor PG tmpfs propio y nueve verifiers instalados.

Sin migraciones nuevas/endpoints/dependencias. No se modifican consultas
cerradas, vacunas/desparasitación, Portal, vínculos o dominios financieros.
Históricos sin motivo/unidad mantienen sus fallbacks; SQL sintético prueba la
conservación de motivo/actor no informados. No nueva retención/purga.

Verificación y límites en [[UX-026-VALIDATION-2026-10-31]]. TD-068 registra
expectativas antiguas fuera del alcance especializado detectadas por una
selección exploratoria; no se ocultan como pruebas aprobadas. Gates
especializados aprobados: 140 API simulados + 467 web/BFF + 160 PostgreSQL real
(767 distintos), lint/tipos/builds aislados y 29/29 E2E reales con retries=0,
incluidos 50 contextos fríos de navegación. Tres capturas desktop/móvil
inspeccionadas. UX-026 done y TD-066 resolved para el alcance documentado; no
suite global web/CI/despliegue.
