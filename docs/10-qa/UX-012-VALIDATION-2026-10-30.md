---
type: qa
status: passed
story: UX-012
date: 2026-10-30
updated: 2026-10-30
---

# UX-012 — Evidencia de consulta de tratamientos

## Alcance y entorno

Windows/PowerShell, rama main. Dependencias instaladas; ejecución directa de
Node/TypeScript/Vitest/ESLint. Vitest usa
NODE_OPTIONS=--experimental-strip-types. Sin instalación de paquetes, seeds de
demo, cobros, mutaciones clínicas o financieras operativas, commit ni push.
Docker Desktop estaba detenido: se inició y se levantó únicamente postgres
usando el volumen existente. Las pruebas crean datos sintéticos solo en una base
temporal, nunca en la de demo.

No hay migraciones ni nuevos campos persistidos. Endpoints aditivos:

- POST `/patients/:patientId/clinical/treatments/search`
- GET `/patients/:patientId/clinical/treatments/:id`

## Pruebas simuladas automatizadas — aprobadas

API: 68 pruebas distintas, sin contar repeticiones:

- `treatment-search.integration.test.ts`: 20. Auth staff, membresía, permiso
  específico, rechazo Portal, body/UUID estrictos, defaults, normalización, no
  texto de búsqueda en logs y cache-control privado en éxitos nuevos. Supertest
  usa la cadena HTTP real; la lectura nueva está simulada en estas pruebas. No
  constituye evidencia de consultas SQL.
- `route-contract.probe.test.ts`: 25. Inventario y permiso exacto de las rutas.
- `clinical.records.service.test.ts`: 13. Regresión de registros especializados.
- `clinical.http.integration.test.ts`: 10. Regresión de contratos y gates
  clínicos existentes, sin operaciones contra datos operativos reales.

Web: 60 pruebas distintas:

- `treatment-list.test.tsx`: 15. POST explícito, filtros/páginas de servidor,
  validación local, carga/vacío/errores/reintentos, lectura de detalle fresco,
  ausencia de contexto, foco al volver, restauración/expiración por paciente,
  descarte con otro QueryClient y aborto/respuestas obsoletas. Sin Storage.
- `patient-detail.test.tsx`: 10. Navegación a Tratamientos y regresión de ficha
  y responsables con API simulada.
- `treatment-read.test.ts`: 16. Proxy nuevo: bytes exactos, cookie solo staff,
  no query strings ni claves extra, aborto, private,no-store, estados/envelope.
- `route.test.ts` del proxy clínico: 19. Regresión de rutas anteriores.

## PostgreSQL real — aprobado

`node --env-file=.env scripts/verify-treatment-search.mjs`: 10 pruebas. El
script exige un nombre aleatorio `newsaas_treatment_search_test_<uuid>` y aplica
migraciones solo allí. DROP de esa misma base en finally y desconexión; salida 0
confirma ejecución y limpieza. Usa el PostgreSQL local existente.

Comprueba páginas de 20, conteo tenant/paciente, pacientes inactivos, desempate
UUID y ausencia de duplicados entre páginas; búsqueda por descripción sin
contexto ni otro paciente/tenant; rango móvil real de administeredAt, ambos
extremos incluidos y futuro excluido; orden antiguo, ajuste de páginas y vacío;
DTO de detalle; mismo NOT_FOUND para referencias extranjeras/inexistentes/de
otro paciente; permiso/entitlement de ambas lecturas; inserción concurrente
entre count y page que no altera el snapshot RepeatableRead. El reloj del
proceso se fija solo en las pruebas temporales del filtro.

## Lint, tipos y builds

Todas las comprobaciones finales aprobadas. Total: 138 pruebas distintas (128
simuladas y 10 PostgreSQL real), sin sumar reejecuciones.

- API lint completo:
  `node node_modules/eslint/bin/eslint.js "src/**/*.ts" "test/**/*.ts"`. Se
  repitió lint de `treatment-search.*` tras las últimas adiciones.
- Web lint completo: node node_modules/eslint/bin/eslint.js .
- API/web tipos: node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit;
  web con --tsBuildInfoFile .ux012.tsbuildinfo para aislar ese metadato.
- API build final: tsc con outDir y tsBuildInfoFile temporales; incluye los
  archivos de pruebas y valida sus tipos finales.
- Web build final: next build en copia temporal, seguido de node
  scripts/verify-build-output.mjs: salida 0 y Build output verification passed.
- Formato de archivos afectados y git diff --check aprobados.

Next.js conservó los avisos informativos ya existentes sobre referencias TS y
plugin Next de ESLint; no impidieron lint/tipos/build. La corrección de act
requiere callback asíncrono y espera de microtareas, evitando tanto async sin
await como await de un valor no Promise. Build aislado bajo
`C:/Users/esteb/AppData/Local/Temp/newsaas-ux012-build-qMxoS0`: API con outDir y
tsBuildInfoFile temporales; copia web con junction a node_modules existente. No
se sobrescriben dist/.next del checkout ni se reinicia un dev server.

Hallazgos corregidos durante verificación:

- El helper clínico infería tipos de entrada opcionales para defaults Zod: el
  controller nuevo usa safeParse y consume su salida validada.
- Lint detectó stringificación ambigua de RequestInfo, act async sin await y
  fallback de contexto ambiguo. Se corrigieron mock, act y condición explícita;
  no se desactivaron reglas. El primer build temporal contenía esa versión
  anterior y se repitió con la copia actualizada.
- Un selector antiguo buscaba cualquier combobox de la ficha; ahora identifica
  su control por “Cliente a vincular”, preservando la misma acción esperada.

## Revisión visual y E2E de navegador — no ejecutados

No se abrió navegador ni se certifican aspecto final, móvil, lector de pantalla,
Back/Forward real o expiración de sesión en navegador. Las comprobaciones de
foco, etiquetas y retorno son pruebas jsdom/componentes. No sustituyen QA
visual. Esta Story acota explícitamente esa revisión fuera de sus gates
obligatorios.

## Límites

Filtro last30 = treinta períodos móviles de 24 horas hasta el instante del
servidor, no un rango calendario configurable. Offset y snapshot por petición,
sin congelar resultados entre páginas; collation actual, sin fuzzy ni
normalización de acentos; page máxima 10000. Contexto en memoria por documento,
sin recuperación tras recarga/reingreso. El detalle abre dentro de la sección,
sin enlace permanente a un tratamiento. Todos los datos clínicos son
CONFIDENTIAL; sin nueva proyección Portal ni logs de texto.

TD-055 sigue abierto: entrada/corrección de tratamientos y superficies de
estudios/pesos no están implementadas en esta etapa.
