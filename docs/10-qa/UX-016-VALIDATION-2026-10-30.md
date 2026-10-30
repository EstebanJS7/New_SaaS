---
type: qa
status: passed
story: UX-016
date: 2026-10-30
updated: 2026-10-30
---

# UX-016 — Registro y corrección de estudios

## Entorno y alcance

Windows/PowerShell, main; cambios locales previos conservados. Binarios
Node/TypeScript/Vitest/ESLint instalados, sin dependencias nuevas. Vitest con
`$env:NODE_OPTIONS='--experimental-strip-types'`. Sin nuevas rutas backend,
esquema, permisos o modificación del PRD. POST/PUT de estudios existentes. Sin
seeds, mutaciones clínicas/financieras operativas, commit o push.

Tipo/fecha/resultado e identificadores CONFIDENTIAL; sin contenido en URL/logs,
Storage o persistencia de formulario. Resultado string vacío permitido, no null.

## Simulación automatizada — aprobada

API: 48 pruebas distintas de contratos existentes:

- `clinical.http.integration.test.ts`: 10. Staff, membresía, permiso granular,
  entitlement, validación e aislamiento de la cadena HTTP simulada.
- `clinical.records.service.test.ts`: 13. Registros especializados/auditoría.
- `route-contract.probe.test.ts`: 25. Inventario y permisos exactos.

Web: 152 pruebas distintas, contando la última ejecución de cada archivo:

- `study-form.test.tsx`: 18. Crear/corregir solo tras confirmación, PUT parcial,
  resultado vacío como string, conversión de fecha Paraguay, conservar segundos/
  milisegundos al editar otros campos, corrección explícita de fecha, doble
  envío, cancelación/descarte, límites, cambios ajenos de tipo o resultado,
  texto multilínea literal, DTO éxito inválido con result null como incierto,
  red/408/500 sin reenvío, 403 sin mensajes internos, claims conocidos, retorno
  con página y confirmación de enlace sin reutilizar destinos cancelados.
- `study-list.test.tsx`: 16. Regresión de consulta y contexto.
- `patient-detail.test.tsx`: 10. Regresión de ficha/responsables.
- `treatment-form.test.tsx`: 15. Regresión de escritura de tratamientos.
- `study-write.test.ts`: 22 y `treatment-write.test.ts`: 22. Proxy POST/PUT:
  bytes exactos, cookie staff/request-id, queries/claves extra rechazadas,
  private,no-store, estados conservados y sin AbortSignal de comandos.
- `study-read.test.ts`: 16 y `route.test.ts`: 19. Regresión de lecturas/proxy.
- `agenda-time.test.ts`: 14. Helper de fechas existente, sin modificarlo.

Vitest ejecutado desde apps/api/web con archivos explícitos. Las mutaciones de
estas pruebas usan DB/fetch simulados, no datos operativos.

La primera corrida web tuvo una única aserción síncrona fallida en resultado
multilínea: el mensaje de éxito ya estaba visible, pero el detalle todavía
reconsultaba. Se conservó la aserción de texto exacto y se esperó su lectura con
findByText. Los otros ocho archivos aprobaron; la repetición acotada del archivo
corregido aprobó 18/18. No se cuenta esa repetición como pruebas nuevas.

## PostgreSQL real desechable — aprobado

`node --env-file=.env scripts/verify-study-entry.mjs`: 9 pruebas. Nombre
aleatorio validado `newsaas_study_entry_test_<uuid>`, migraciones y datos
sintéticos solo en esa base. Pacientes con responsables primarios válidos y
actor persistido. DROP exclusivo de la base temporal en finally; salida 0
confirma limpieza.

ClinicalRecordsService y AuditWriter reales sobre Prisma/PostgreSQL con contexto
de tenant y permisos/entitlement controlados en fixture. Cubre creación con un
audit de actor/tenant/campos sin texto clínico, contrato Zod de result vacío y
rechazo de null, corrección parcial preservando instante preciso/resultado,
limpiar resultado con "", no-op sin audit adicional, aislamiento en creación y
corrección para ajeno/inexistente/otro paciente sin efectos, create/update
diferenciados y entitlement, rollback de crear y corregir ante falla de
auditoría. Esto no certifica una sesión HTTP real sobre una base de producción.

## Lint, tipos y builds

Lint completo y tipos API/web aprobados:

- API: `node node_modules/eslint/bin/eslint.js "src/**/*.ts" "test/**/*.ts"`.
- Web: `node node_modules/eslint/bin/eslint.js .`.
- Tipos: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`; web
  con `--tsBuildInfoFile .ux016.tsbuildinfo`.

Builds API/web aislados aprobados, incluyendo tipos finales de pruebas. Next
build y `node scripts/verify-build-output.mjs` finalizaron con salida 0 y Build
output verification passed. Total 209 distintas (200 simuladas y 9 PostgreSQL
real), sin sumar repeticiones. Formato y git diff --check aprobados. Copia
temporal `C:/Users/esteb/AppData/Local/Temp/newsaas-ux016-build-lyXF7t`: API
outDir y tsBuildInfoFile temporales; web con junction al node_modules existente.
Sin sobrescribir dist/.next ni reiniciar procesos locales. Next/TS y detección
de plugin Next/ESLint mantienen los avisos informativos existentes.

## Visual/E2E — no ejecutados

Sin navegador ni certificación de aspecto final, móvil, lector de pantalla,
Back/Forward o sesión expirada. Modal/foco/etiquetas/salida por clic verificados
en jsdom/componentes, separados de revisión visual. Esos gates no son requeridos
por la Story en esta etapa acotada.

## Límites

TD-066 se extiende a estudios. GET previo no es CAS: ventana de carrera hasta
PUT sin versión ni historial de valores anteriores. POST sin idempotencia;
respuesta incierta requiere revisión manual y bloquea reenvío de ese formulario.
No recuperación de borrador tras desmontaje, recarga/reingreso, Back/Forward o
navegación programática. Clic/cancelar y beforeunload advierten cambios.

Shell sin claims en esta sección; frontend usa permisos opcionales conocidos,
desconocidos muestran acciones con rechazo API explícito. Backend es autoridad.
Fecha editada a minuto, sin reinterpretar fecha precisa al modificar otros
campos. Usa Intl/agenda existentes; limitaciones locales de tzdata en TD-064 no
se declaran resueltas aquí. Resultado vacío no implica un estado clínico.

TD-055 queda para entrada/corrección de pesos y definición de unidad de DEC-084,
que continúa propuesta. Módulo, guía y changelog actualizados, PRD intacto.
