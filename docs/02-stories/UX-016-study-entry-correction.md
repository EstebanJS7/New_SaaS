---
id: UX-016
type: story
title: Staff study entry and explicit correction
epic: EPIC-06
status: done
priority: high
depends_on: [VET-004, UX-013, UX-015]
prd_sections: ["9", "12", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-016 — Registrar y corregir estudios

ID verificado disponible. Continuación autorizada: entrada/corrección staff de
estudios con POST/PUT existentes. [[Clinical]], [[TD-055]], [[TD-066]],
[[DEC-067]], [[DEC-080]], [[ADR-001]]. Sin PRD, esquema, contratos o permisos
nuevos.

## Criterios

- [x] Registrar desde sección Estudios y Corregir desde detalle fresco. Tipo
      requerido hasta 2000, fecha/hora de realización y resultado hasta 10000.
      Resultado vacío permitido como string vacío, no null, estado ni
      diagnóstico.
- [x] Revisión/confirmación antes de POST/PUT; PUT solo campos modificados y
      resultado vaciado como "". Sin autosave ni escritura al abrir/navegar.
- [x] Fecha en reloj Paraguay mediante conversor de agenda existente. Cambiar
      otros campos preserva segundos/milisegundos originales; fecha editada se
      guarda con precisión de minuto, sin usar zona del navegador como
      autoridad.
- [x] Relectura previa a corrección bloquea cambios remotos visibles en campos
      modificados; no promete CAS/versionado backend ni historial que no existe.
      No reintentos automáticos/doble envío; red/408/5xx/respuesta ilegible
      bloquean reenvío y piden revisar registro/listado. Límites en TD-066.
- [x] Errores conservan formulario montado, cancelar/salir por enlace requiere
      confirmación con cambios, beforeunload advierte; sin borrador en
      URL/logs/Storage/persistencia, ni recuperación prometida tras desmontaje,
      recarga/reingreso/Back-Forward. Permitir anclas del mismo documento.
- [x] Éxito abre detalle guardado, confirma acción e invalida lecturas sin
      perder filtros/página temporal del paciente. Español, es-PY, tokens
      semánticos, controles etiquetados, foco y errores accesibles, texto
      literal sin HTML.
- [x] Staff/membresía, tenant del contexto, veterinary y permisos create/update
      separados se conservan en backend; aislamiento/auditoría co-commit
      verificados. Frontend es UX-only: permisos conocidos ocultan acciones,
      shell actual sin claims mantiene rechazo API como autoridad.
- [x] Pruebas UI/HTTP/proxy simuladas, PostgreSQL desechable real para comandos
      y rollback de auditoría, lint/tipos/builds aislados aprobados. Sin datos
      operativos ni nueva ronda visual/E2E como gate de esta etapa acotada.
- [x] Actualizar módulo, guía, QA, changelog y deudas. No modificar
      tratamientos, pesos, vacunas, consultas, vínculos, archivos, Portal,
      inventario o finanzas.

## Clasificación y límites

Tipo, fecha, resultado y IDs existentes CONFIDENTIAL. Sin campos persistidos,
retención, dependencias o abstracción compartida nuevos. Especializados usan PUT
auditado sobre el registro, no amendment de consulta cerrada. TD-066 aplica a
ambos formularios; TD-055 quedará abierto para entrada/corrección de pesos y la
unidad de DEC-084 sigue sin aprobarse. Sin commit ni push.

## Implementación y verificación

Implementados study-form.tsx y study-write-api.ts e integrados en StudyList.
Tipo/fecha/resultado con confirmación, PUT parcial y resultado vaciado como
string. Proxy clínico privado para POST/PUT de estudios; contratos backend
existentes conservados. Sin nuevos endpoints API, esquema o dependencias.

209 pruebas distintas aprobadas: 48 API (10 HTTP, 13 registros, 25 rutas), 152
web (18 formulario, 16 listado, 10 ficha, 15 regresión de tratamientos, 44 proxy
de escritura nuevo/previo, 35 proxy de lectura/legado y 14 fechas), 9 PostgreSQL
real de comandos/auditoría. Sin sumar reejecuciones; la aserción multilínea se
corrigió para esperar reconsulta y aprobó 18/18 en el archivo. Ver
[[UX-016-VALIDATION-2026-10-30]].

Lint completo y tipos API/web, builds aislados y verificación de salida Next.js
aprobados. Formato/diff sin errores. Sin revisión visual/E2E de navegador ni
mutaciones operativas; pruebas de componente no certifican móvil/lector/sesión.

Clinical, guía, changelog y TD-055 actualizados. TD-055 queda para entrada y
corrección de pesos; DEC-084 sigue propuesta. TD-066 extendido a estudios sin
prometer versión, idempotencia o recuperación de borradores. Shell sin claims en
esta sección; backend conserva autorización granular. Cambios locales previos y
PRD conservados. Sin commit ni push.
