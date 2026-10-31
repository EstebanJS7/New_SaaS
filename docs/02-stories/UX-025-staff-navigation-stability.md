---
id: UX-025
type: story
title: Stable same-document staff navigation and clinical validation
epic: EPIC-03
status: done
priority: high
depends_on: [UX-021, UX-024]
prd_sections: ["10.1", "13.3", "29", "41"]
branch: main
created: 2026-10-31
updated: 2026-10-31
---

# UX-025 — Navegación staff estable

ID libre verificado. Usuario autorizó resolver TD-067 antes del ajuste de
contratos preproductivos. Conservar todos los cambios acumulados; sin commit,
push, migración/configured DB, nuevos paquetes o actualización/parche de Next.

## Criterios

- [x] Reproducción acotada de navegación Inicio→Pacientes→ficha con enlaces
      reales y documento conservado; registrar fallos/límites sin retries/goto
      sustituto, CSPrelajada o instrumentación sensible persistente.
- [x] Corrección mínima basada en evidencia; conservar shell/autorización,
      marca, estados de carga/error y copias UX-018/024. No tocar lógica de
      otros dominios, contratos clínicos o configuración dev para este
      diagnóstico.
- [x] Pruebas pertinentes de shell/pacientes, lint/tipos/build aislado y dos
      ejecuciones completas independientes de los 25 E2E clínicos más navegación
      repetida, sin retries, con API/PG/Redis propios y datos sintéticos.
- [x] Actualizar TD-067, UX-024, Clinical, guía, changelog y QA separando
      diagnóstico, simulación, PG/E2E, revisión visual y límites. Cerrar UX-024
      solo con sus gates aprobados; no afirmar estabilidad universal.

## Implementación y verificación

Se retiró la barrera Next global app/(app)/app/loading.tsx conservando
RouteFeedback y las cargas/errores cliente existentes. Sin nuevos paquetes,
parches vendor, cambios de auth/CSP/prefetch, reload o retries. El contraste
previo con contextos nuevos reprodujo en entrada 10 (9 completas), root
pending/suspended/warm=229376 y pinged=0; HTTP RSC 200. No inferir universalidad
o identidad causal con un reporte upstream solo desde ese patrón.

73 casos web de shell/layouts/nonce/sesión/pacientes aprobados; expectativas
antiguas inglesas de tres archivos corregidas al texto español real sin cambiar
producto/gates. Lint/tipos web/e2e, builds aislados API/database/web y
verificador Next aprobados. Dos lanes independientes rXaXqy y PX3EwT, 26/26 cada
una: 25 E2E clínicos y 50 contextos fríos por ronda, documento conservado, carga
de paciente retenida comprobada, retries=0. Dos capturas móviles inspeccionadas.

Ver [[UX-025-VALIDATION-2026-10-31]]. TD-067 resolved de forma acotada; UX-024
cierra su pendiente de lane completa. DEC-085 aceptada para el ajuste
preproductivo posterior, UX-026 planned: aún no se exige en código global.
