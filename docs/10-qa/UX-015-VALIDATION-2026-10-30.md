---
type: qa
status: passed
story: UX-015
date: 2026-10-30
updated: 2026-10-30
---

# UX-015 — Registro y corrección de tratamientos

## Entorno y alcance

Windows/PowerShell, main, cambios locales UX-012/013/014 conservados. Binarios
instalados, sin reinstalar dependencias. Vitest con
`$env:NODE_OPTIONS='--experimental-strip-types'`. PostgreSQL existente 5433. Sin
seeds, comandos clínicos/financieros operativos, commit/push o cambio de PRD.

POST/PUT de tratamientos ya existentes; sin nuevas rutas API, migración, permiso
o columna. Frontend usa formulario/confirmación y proxy autenticado. Datos
clínicos CONFIDENTIAL, sin campos en URL/logs/Storage ni nuevo Portal.

## Pruebas simuladas — aprobadas

API: 48 distintas, contratos existentes:

- `clinical.http.integration.test.ts`: 10. Autenticación, membresía, permisos
  por operación, entitlement, UUID/body y aislamiento en cadena HTTP simulada.
- `clinical.records.service.test.ts`: 13. Registros especializados/auditoría.
- `route-contract.probe.test.ts`: 25. Inventario y permiso granular exacto.

Web: 111 distintas, sin sumar reejecuciones:

- `treatment-form.test.tsx`: 15. POST solo tras confirmación, PUT parcial,
  contexto null, fecha en reloj Paraguay, conservación de segundos/milisegundos
  al editar otros campos, edición explícita de fecha, doble envío bloqueado,
  cancelación/revisión y descarte, límites de campos, relectura ante cambio
  remoto, errores 403 sin detalles privados, bloqueo de reenvío tras
  red/408/500, acciones ocultas con permisos conocidos, conservación de página y
  enlaces de salida. Incluye olvidar un destino de salida cancelado.
- `treatment-list.test.tsx`: 15. Regresión de consulta/contexto/aborto/foco.
- `patient-detail.test.tsx`: 10. Regresión de ficha y responsables.
- `treatment-write.test.ts`: 22. POST/PUT proxy: bytes exactos, cookie staff, no
  headers de autoridad del navegador, private,no-store, query/claves extra
  rechazadas y estados de error. Comandos no envían AbortSignal upstream.
- `treatment-read.test.ts`: 16 y `route.test.ts`: 19. Regresión del proxy
  previo.
- `agenda-time.test.ts`: 14. Conversión horaria reutilizada; no cambios del
  helper.

Ejecutadas con Vitest desde API/web y archivos explícitos. Los comandos que
aparecen en estas pruebas usan fetch o DB simulados; no mutan registros reales.

## PostgreSQL real desechable — aprobado

`node --env-file=.env scripts/verify-treatment-entry.mjs`: 8 pruebas. Base
aleatoria validada `newsaas_treatment_entry_test_<uuid>`, migraciones solo allí,
datos sintéticos con responsables primarios válidos. DROP exclusivo de esa base
en finally; salida 0 confirma ejecución y limpieza. No base demo.

Servicio ClinicalRecordsService real, RequestContext y AuditWriter real sobre
Prisma/PostgreSQL. Cubre creación con un audit de actor/tenant/campos, sin texto
clínico; corrección parcial preservando fecha precisa y contexto; limpieza null;
no-op sin audit extra; rechazo de paciente/tratamiento extranjero, inexistente o
de otro paciente sin cambios/audit; create/update diferenciados y entitlement;
rollback de creación y de corrección al fallar audit append.

## Lint, tipos, builds

Lint completo API/web aprobado:

- `node node_modules/eslint/bin/eslint.js "src/**/*.ts" "test/**/*.ts"` en API.
- `node node_modules/eslint/bin/eslint.js .` en web.
- Tipos API/web:
  `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`; web usa
  `--tsBuildInfoFile .ux015.tsbuildinfo`.

Builds API/web finales aislados aprobados; API valida también los tipos de sus
pruebas finales. Next build y `node scripts/verify-build-output.mjs` finalizan
con salida 0 y Build output verification passed. Tipo noEmit final API/web
también aprobado. Total 167 pruebas distintas (159 simuladas y 8 PostgreSQL
real), sin sumar reejecuciones. Formato/diff sin errores. Directorio
`C:/Users/esteb/AppData/Local/Temp/newsaas-ux015-build-1X3fXJ`: API con outDir y
tsBuildInfoFile temporales, web copiada y junction a node_modules instalado. No
sobrescribe dist/.next ni reinicia procesos locales.

Hallazgos corregidos, sin debilitar reglas:

- Fixture PG inicialmente creó pacientes activos sin responsable; el trigger
  impidió la suite (8 sin ejecutar). Se construyen responsable y paciente en
  transacción, activando el paciente al cumplir su invariant. Nueva corrida 8/8.
- Tipos detectaron incompatibilidad de firma Prisma y fachada de audit con JSON
  unknown; adaptador tipado local al test, sin cambios de implementación ni any.
- Lint pidió optional chaining; corrección equivalente, sin reglas desactivadas.
- Revisión detectó reutilización de destino de enlace cancelado: limpiado y
  fijado por prueba. Timeout HTTP 408 se clasifica como resultado incierto.

Next.js conserva avisos informativos existentes de referencias TS y plugin
Next/ESLint. Se usa Intl existente; el runtime Node 22.14 tiene las limitaciones
de tzdata ya registradas en TD-064. No se certifica actualización del runtime
global ni de todos los navegadores por estas pruebas de fecha acotadas.

## Visual/E2E — no ejecutados

Sin navegador, mutaciones operativas o certificación de aspecto final, móvil,
lector de pantalla, Back/Forward o sesión expirada. Etiquetas, modal, foco,
confirmación y salida por clic se verifican en jsdom; no equivalen a revisión
visual/E2E. Esos gates no son requeridos por la Story en esta etapa.

## Límites visibles

TD-066: GET previo no es compare-and-swap; hay carrera hasta PUT y no historial
de valores previos. POST no idempotente; respuesta incierta obliga revisión
manual y bloquea el reenvío del mismo formulario. No se introducen contratos
ficticios para prometer garantías ausentes. El formulario vive solo montado: sin
recuperación tras recarga, sesión, Back/Forward o navegación programática. Antes
de salir por clic/cancelar y en beforeunload se advierten cambios.

Shell no entrega claims a esta sección; permisos opcionales conocidos ocultan
acciones, desconocidos muestran acciones con rechazo API explícito. Seguridad
real corresponde al backend y se verificó aparte de esas affordances.

TD-055 reducido a entrada/corrección de estudios y pesos; DEC-084 de unidad
sigue propuesta. Módulo, guía y changelog actualizados, PRD intacto.
