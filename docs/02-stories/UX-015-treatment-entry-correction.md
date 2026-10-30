---
id: UX-015
type: story
title: Staff treatment entry and explicit correction
epic: EPIC-06
status: done
priority: high
depends_on: [VET-004, UX-012]
prd_sections: ["9", "12", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-015 — Registrar y corregir tratamientos

ID verificado disponible. Alcance autorizado: completar la superficie staff de
tratamientos usando POST/PUT existentes. [[Clinical]], [[TD-055]], [[DEC-067]],
[[DEC-080]], [[ADR-001]]. Sin cambios del PRD ni de contratos de otros
consumidores.

## Criterios

- [x] Nueva acción y formulario en sección Tratamientos, con descripción
      requerida (hasta 2000), fecha/hora de administración y contexto opcional
      (hasta 10000). Español, tokens semánticos, etiquetas y errores accesibles.
- [x] Corregir desde detalle fresco; revisión y confirmación explícitas para
      crear/corregir. Cancelación con confirmación si hay cambios. Preservar
      borrador ante error; sin autosave ni escritura al navegar/abrir.
- [x] Fecha en reloj Paraguay mediante conversor existente de agenda, sin
      depender de zona del navegador. Corregir otros campos no altera segundos o
      milisegundos originales; fecha editada tiene precisión de minuto.
- [x] PUT solo campos modificados; vaciar contexto envía null. Relectura antes
      de PUT detecta cambios en campos a corregir y bloquea sobreescritura
      visible. No prometer control de versión que la API no tiene: [[TD-066]].
- [x] No reintentos automáticos ni doble envío; ante red/5xx/respuesta incierta
      bloquear reenvío e indicar revisar listado antes de volver a registrar. No
      crear idempotencyKey o ruta nuevos sin contrato aprobado.
- [x] Staff, tenant, veterinary y permisos create/update existentes en backend,
      aislamiento y auditoría co-commit verificados. Checks frontend UX-only;
      permissions conocidos ocultan acciones, desconocidos siguen patrón actual.
- [x] Tras éxito invalidar listado/detalle y volver al detalle guardado, con
      mensaje explícito, conservando filtros/página temporal y contexto por
      paciente.
- [x] Sin logs/URL/Storage/persistencia de formulario. Cancelar o salir
      explícitamente descarta; beforeunload y clic de enlace advierten cambios.
      No recuperación prometida tras recarga, Back/Forward o sesión expirada.
- [x] Pruebas UI/HTTP/proxy simuladas, PostgreSQL real desechable de comandos y
      auditoría, lint, tipos y builds aislados. Sin mutaciones clínicas
      operativas o nueva ronda visual/E2E de navegador; límites separados en
      evidencia.
- [x] Actualizar módulo, guía, QA, changelog y TD-055; estudios/pesos, vacunas,
      consultas, vínculos clínicos, inventario y finanzas fuera de alcance.

## Clasificación y límites

Campos e identificadores clínicos CONFIDENTIAL; mismos campos/retención/Portal
existentes. No esquema/dependencias nuevos. Especializados usan corrección PUT
auditada, no amendment de consulta cerrada. [[TD-066]] registra límites de
concurrencia/idempotencia/navegación; no se alteran invariantes de encuentros.

## Implementación y verificación

Implementados treatment-form.tsx y treatment-write-api.ts, integrados en el
listado/detalle existente. POST/PUT de tratamientos conservados; proxy privado
para comandos, confirmación, cuerpo parcial, limpieza null y guardias de envío y
salida. No se modifican algoritmos de backend: solo comentario corregido para
reflejar PUT auditado en registros especializados. Sin migraciones/dependencias.

167 pruebas distintas aprobadas: 48 API (10 HTTP, 13 registros, 25 rutas), 111
web (15 formulario, 15 listado, 10 ficha, 22 proxy de escritura, 35 proxy previo
y 14 fechas), 8 PostgreSQL real de comandos y auditoría. Fixture PG con
responsable primario válido; rollback al fallar auditoría verificado. Sin
mutaciones operativas ni datos demo. Ver [[UX-015-VALIDATION-2026-10-30]].

Lint completo, tipos API/web, builds aislados y verificación de salida Next.js
aprobados. Formato/diff verificados. Sin revisión visual/E2E de navegador; jsdom
no certifica móvil/lector/Back-Forward.

Módulo, guía UX/UI, changelog y TD-055 actualizados. TD-055 queda abierto para
estudios y pesos; DEC-084 sigue propuesta sobre unidad. TD-066 explicita
concurrencia sin versión, POST sin idempotencia y recuperación no implementada.
No hay claims del shell para esta sección: permisos frontend opcionales siguen
patrón previo; backend impone create/update. PRD y cambios locales anteriores
conservados. Sin commit ni push.
