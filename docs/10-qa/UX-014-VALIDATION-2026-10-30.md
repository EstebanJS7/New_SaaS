---
type: qa
status: passed
story: UX-014
date: 2026-10-30
updated: 2026-10-30
---

# UX-014 — Evidencia de consulta de pesos

## Entorno y alcance

Windows/PowerShell, main. Cambios locales UX-012/UX-013 conservados.
Dependencias instaladas, ejecución directa de Node/TypeScript/Vitest/ESLint, sin
instalación de paquetes. Vitest con
`$env:NODE_OPTIONS='--experimental-strip-types'`. PostgreSQL existente saludable
en 5433. Sin seeds ni mutaciones clínicas o financieras operativas; sin
commit/push ni modificación del PRD.

Endpoints aditivos:

- POST `/patients/:patientId/clinical/weights/search`
- GET `/patients/:patientId/clinical/weights/:id`

No texto buscable inventado. Filtros de rango inclusivo positivo, período y
orden; DTO mínimo con cantidad/fecha. El modelo no tiene unidad: se muestra
explícitamente esa ausencia y [[DEC-084-weight-measurement-unit]] queda
propuesta, sin campos o migraciones nuevos ni inferencia de kg.

## Simulación automatizada — aprobada

API: 77 pruebas distintas mediante Vitest con archivos explícitos:

- `weight-search.integration.test.ts`: 29. Gates staff/membresía/permiso,
  rechazo Portal, UUID/body estricto, límites inválidos/invertidos, sin q,
  defaults, normalización y ausencia de valores en logs. Cache-control privado
  en nuevas lecturas exitosas. La cadena HTTP es real; la lectura está simulada,
  por lo que esta evidencia no prueba SQL.
- `route-contract.probe.test.ts`: 25. Rutas y permiso exacto.
- `clinical.http.integration.test.ts`: 10. Regresión de contratos/gates previos.
- `clinical.records.service.test.ts`: 13. Regresión de registros especializados.

Web: 104 pruebas distintas:

- `weight-list.test.tsx`: 26, de las cuales 11 cubren parser/rango local y 15
  interfaz. Coma decimal, agrupación, límites adyacentes exactos, valores
  inválidos, POST explícito, sin q/Storage, resultados/páginas del servidor,
  período/orden con reset, detalle fresco, foco/retorno, contexto por paciente y
  expiración/nuevo documento, aborto/respuestas obsoletas,
  vacío/errores/reintento y extremos de NUMERIC(10,3) en es-PY sin unidad
  inventada.
- `patient-detail.test.tsx`: 10. Ancla Pesos y regresión de ficha/responsables.
- `weight-read.test.ts`: 17. Proxy: body exacto, cookie staff, rechazo de q,
  queries/claves extra, private,no-store, aborto, estado/envelope y detalle.
- `study-read.test.ts`: 16, `treatment-read.test.ts`: 16 y `route.test.ts`: 19.
  Regresión del proxy clínico previo.

Ejecutadas con `node node_modules/vitest/vitest.mjs run` y archivos explícitos
desde apps/api o apps/web. Las pruebas de ficha usan solo APIs simuladas.

## PostgreSQL real — aprobado

`node --env-file=.env scripts/verify-weight-search.mjs`: 10 pruebas. Runner con
nombre aleatorio validado `newsaas_weight_search_test_<uuid>`, migraciones
aplicadas únicamente allí, datos sintéticos y DROP exclusivo de esa base en
finally. Salida 0 confirma ejecución y limpieza. No se modifica la base demo.

Comprueba páginas de veinte, conteo/paciente/tenant, pacientes inactivos,
desempate UUID sin duplicados, límites inclusivos exactos (0.001, 12.345 y
9999999.999), exclusión de valores de otro paciente/tenant, rango combinado con
período por measuredAt, orden antiguo, página ajustada/vacía, serialización
exacta de escala tres sin unidad, mismo NOT_FOUND para referencias
extranjeras/inexistentes/de otro paciente, permiso/entitlement de ambas
lecturas, snapshot ante inserción concurrente entre count/filas y extremos de
ventana temporal incluidos con futuro excluido. Solo las pruebas temporales
fijan Date.

## Lint, tipos y builds

Lint completo y tipos API/web aprobados:

- API: `node node_modules/eslint/bin/eslint.js "src/**/*.ts" "test/**/*.ts"`.
- Web: `node node_modules/eslint/bin/eslint.js .`.
- Tipos: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`; web
  con `--tsBuildInfoFile .ux014.tsbuildinfo`.

Builds API y web aislados aprobados. Next build seguido de
`node scripts/verify-build-output.mjs`: salida 0, Build output verification
passed. 191 pruebas distintas aprobadas (181 simuladas y 10 PostgreSQL real),
sin sumar reejecuciones. Formato de archivos afectados y git diff --check
aprobados. Directorio temporal
`C:/Users/esteb/AppData/Local/Temp/newsaas-ux014-build-OaGGF0`: API con
outDir/tsBuildInfoFile temporales, web copiada con junction a node_modules
existente. No se sobrescriben dist/.next del checkout ni se reinician procesos
de desarrollo. Avisos informativos existentes Next/TS y plugin ESLint se
registran separadamente de fallas.

## Revisión visual/E2E — no ejecutada

Sin nueva ronda de navegador. No se certifican aspecto final, móvil, lector de
pantalla, Back/Forward ni sesión expirada en navegador. Etiquetas/foco/retorno
verificados mediante componentes jsdom; no equivalen a evidencia visual o E2E.
Esta Story no exige esos gates en la etapa de consulta acotada.

## Límites

NUMERIC(10,3) almacenado se serializa a escala tres sin Number, aritmética o
conversión. Comparación de límites con Prisma.Decimal en backend y BigInt de
milésimas en frontend. No campo de unidad ni unidad canónica aprobada; no
gráfico/interpretación clínica, peso actual derivado, redondeos o conversión.
last30 = treinta períodos de 24 horas hasta ahora en servidor; snapshot por
petición, offset sin congelar páginas entre peticiones, máximo 10000. Contexto
en memoria del documento diez minutos; recarga/reingreso lo descartan. Sin
contenido en URL, logs, Storage, Portal o retención nueva.

Módulo, guía, changelog y TD-055 actualizados. TD-055 sigue abierto para
entrada/corrección de tratamientos, estudios y pesos; esas consultas no cierran
la deuda de escritura. DEC-084 sigue propuesta, PRD intacto.
