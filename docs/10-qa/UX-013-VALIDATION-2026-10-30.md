---
type: qa
status: passed
story: UX-013
date: 2026-10-30
updated: 2026-10-30
---

# UX-013 — Evidencia de consulta de estudios

## Alcance y entorno

Windows/PowerShell, rama main; cambios locales UX-012 conservados. Binarios
Node/TypeScript/Vitest/ESLint instalados, sin reinstalar dependencias. Vitest
con `$env:NODE_OPTIONS='--experimental-strip-types'`. PostgreSQL existente sano
en puerto 5433. Sin seeds, mutaciones clínicas/financieras operativas, commit o
push. Sin migraciones, dependencias nuevas ni cambios del PRD.

Endpoints aditivos:

- POST `/patients/:patientId/clinical/studies/search`
- GET `/patients/:patientId/clinical/studies/:id`

## Simulación automatizada — aprobada

API: 68 pruebas distintas:

- `study-search.integration.test.ts`: 20. Autenticación staff, membresía activa,
  permiso específico, rechazo Portal, UUID/body estrictos, defaults,
  normalización, ausencia del texto de búsqueda en logs y private,no-store en
  éxitos. Supertest ejecuta la cadena HTTP; la lectura nueva está simulada, no
  es evidencia de SQL.
- `route-contract.probe.test.ts`: 25. Inventario de rutas y permiso exacto.
- `clinical.http.integration.test.ts`: 10. Regresión de contratos y gates
  previos.
- `clinical.records.service.test.ts`: 13. Regresión de registros especializados.

Web: 77 pruebas distintas:

- `study-list.test.tsx`: 16. Búsqueda solo al enviar, cuerpo POST, filtros y
  páginas de servidor, vacío/carga/errores/reintentos, autorización explícita,
  detalle fresco, resultado vacío, multilinea literal sin interpretar HTML, foco
  al retornar, contexto por paciente/expiración/nuevo QueryClient, respuestas
  obsoletas y cancelación. Sin escrituras a Storage.
- `patient-detail.test.tsx`: 10. Ancla Estudios y regresión de
  ficha/responsables.
- `study-read.test.ts`: 16. Proxy nuevo: bytes exactos, cookie solo staff,
  query/claves extra rechazadas, aborto, cache-control, estados/envelope.
- `treatment-read.test.ts`: 16 y `route.test.ts`: 19. Regresión de lecturas de
  tratamientos y del resto del proxy clínico existente.

Ejecutadas mediante `node node_modules/vitest/vitest.mjs run` con los archivos
anteriores explícitos desde API/web. No navegador ni datos operativos reales.

## PostgreSQL real — aprobado

`node --env-file=.env scripts/verify-study-search.mjs`: 10 pruebas. El runner
valida nombre aleatorio `newsaas_study_search_test_<uuid>`, crea esa base
desechable, aplica migraciones allí, ejecuta el servicio Prisma real con
contexto de tenant y borra exclusivamente esa base en finally. Salida 0 confirma
ejecución y limpieza; datos sintéticos no se escriben en la base de desarrollo.

Cubre 20 filas por página, conteo tenant/paciente, paciente inactivo y UUID de
desempate sin duplicados entre páginas; búsqueda case-insensitive solo por tipo,
sin resultados clínicos ni otros pacientes/organizaciones; orden antiguo,
páginas ajustadas/vacías; ventana móvil por performedAt, extremos incluidos y
futuro excluido; detalle allowlisted; mismo error para inexistente, extranjero y
otro paciente; permiso/entitlement reafirmados en search/get; inserción
concurrente entre count/filas sin alterar el snapshot RepeatableRead. Reloj
fijado únicamente en pruebas de la ventana temporal.

## Lint, tipos y builds

Lint completo API/web y typecheck API/web aprobados. Comandos equivalentes:

- API: `node node_modules/eslint/bin/eslint.js "src/**/*.ts" "test/**/*.ts"`.
- Web: `node node_modules/eslint/bin/eslint.js .`.
- Tipos: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`; web
  agrega `--tsBuildInfoFile .ux013.tsbuildinfo`.

Build API aislado aprobado, con outDir/tsBuildInfoFile temporales. Build web
aprobado mediante next build y verificación final con
`node scripts/verify-build-output.mjs`: salida 0 y Build output verification
passed. Total 155 pruebas distintas (145 simuladas, 10 PostgreSQL real), sin
sumar reejecuciones. Formato de archivos afectados y git diff --check aprobados.
Copia temporal:
`C:/Users/esteb/AppData/Local/Temp/newsaas-ux013-build-DbI4yz/web`, con junction
a node_modules existente. Sin sobrescribir dist/.next del checkout ni reiniciar
procesos de desarrollo. Next.js mantiene los avisos informativos existentes
sobre referencias TS y detección de plugin Next/ESLint.

## Revisión visual y E2E — no ejecutados

Sin ronda de navegador. No se certifican aspecto final, móvil, lector de
pantalla, Back/Forward real ni sesión expirada en navegador. Etiquetas y foco
verificados en jsdom/componentes, separados de evidencia visual. No son gates
requeridos de esta etapa acotada por la Story.

## Límites y documentación

studyType es texto existente, no categoría normalizada; result solo en detalle.
Resultado vacío no implica pendiente/negativo. last30 son treinta períodos de 24
horas hasta el instante del servidor. Offset/snapshot por petición, sin congelar
resultados entre páginas; collation existente, sin fuzzy ni normalización de
acentos. Página máxima 10000. Contexto confidencial en memoria por documento
diez minutos, sin recuperación tras recarga/reingreso. Sin URL permanente del
estudio; detalle dentro de sección. Sin logs de contenido, Storage, Portal ni
retención nueva.

Módulo Clinical, guía de continuidad, changelog y TD-055 actualizados. TD-055
continúa abierto: falta entrada/corrección de tratamientos/estudios y superficie
de pesos. No se modifican los criterios ni la evidencia previa de UX-012.
