---
type: qa
title: Validación de búsqueda paginada de catálogo UX-011
status: active
created: 2026-10-29
updated: 2026-10-29
related_stories: [UX-011]
---

# UX-011 — Evidencia del listado de catálogo

## Alcance y entorno

Listado existente conectado a POST /catalog/search y nuevo proxy privado
/api/catalog/search. GET /catalog, tax-rates, CatalogService/Repository,
catalog-api.ts, comandos y consumidores del POS/agenda conservados. Sin cambios
a valores de precios, tasas, stock, movimientos o cálculos. Sin migraciones,
dependencias nuevas, permisos, entitlement, PRD, commit o push. Se preservó el
árbol local ya modificado al comenzar, incluido el PRD.

Node del host 22.14.0; NODE_OPTIONS=--experimental-strip-types para Vitest,
según la configuración compartida existente/TD-064. Herramientas instaladas
invocadas directamente, sin reinstalar dependencias ni llamar al lanzador pnpm.
Pruebas/builds se ejecutaron fuera del sandbox por sus restricciones conocidas
de resolución de esbuild. PostgreSQL disponible en puerto 5433; no se reinició
Docker ni se cargaron seeds demo. Sin navegador ni cobros.

## PostgreSQL real — 11/11

El runner verify-catalog-search.mjs crea una base aleatoria
newsaas_catalog_search_test_<uuid>, aplica migraciones actuales solamente allí y
la elimina en finally. El test valida el patrón antes de conectar. La ejecución
salió con código 0 y eliminó la base temporal, sin reset o migraciones sobre
desarrollo.

catalog-search.pg.test.ts usa servicio/Prisma/PostgreSQL reales y resolución de
permisos controlada. Casos:

- Página limitada a veinte, segunda página, total solo del tenant, sin
  duplicados y desempate estable por UUID con nombres/fechas repetidos; DTO
  exacto.
- Búsqueda por nombre sin distinguir mayúsculas; un nombre ajeno no filtra datos
  de otro tenant y el nombre de impuesto no amplía la búsqueda.
- Cuatro casos, uno por tipo real: PRODUCT, SERVICE, MEDICATION y SUPPLY, con
  conteo consistente y filtro de activos.
- Combinación de tipo/estado, todos/inactivos, página ajustada y vacío.
- Orden de creación reciente con UUID de desempate.
- Precio exacto NUMERIC(14,2) con todos los dígitos, cero como 0.00, ausencia
  null y moneda sin conversión; nombre de tasa global proyectado.
- Revalidación de catalog.read en el servicio.
- Un cambio sintético de isActive desde otra conexión entre count y findMany
  demuestra un snapshot RepeatableRead coherente para conteo y filas.

Solo fixtures sintéticos en la base temporal, incluida su tasa global de prueba.
No se llamaron comandos de catálogo, ventas, pagos, caja, inventario, clínica o
emisión fiscal sobre datos operativos. La actualización concurrente ocurrió
exclusivamente en esa base temporal. Sin benchmark de grandes volúmenes.

## HTTP/guardas y regresión backend con dobles — 79/79

- 19/19 catalog-search.integration.test.ts: app/guardas reales con lectura
  sustituida; autenticación, membresía activa, catalog.read, Portal con sesión
  viva rechazado, límites/defaults/cuerpo estricto y texto fuera de logs.
- 25/25 route-contract.probe.test.ts: inventario completo y mapa granular del
  catálogo actualizados con la única ruta nueva POST /catalog/search.
- 23/23 catalog.integration.test.ts: regresión de contratos y comandos
  anteriores sobre el harness simulado; no representa mutaciones PostgreSQL
  reales.
- 12/12 catalog.repository.test.ts: persistencia/tenant scope con dobles.

Los diecinueve casos HTTP sustituyen el read para aislar la frontera. El SQL
real se demuestra en los once casos de PostgreSQL, no en ese harness.

## Componentes, transporte y proxies — 60 casos distintos

- 11 casos catalog-search-list.test.tsx: POST explícito, filas de servidor sin
  filtrar localmente, conteo/paginación/límites, reset por filtros/orden/tipo,
  remonte con búsqueda/estado/tipo/orden/página, expiración/nuevo QueryClient,
  validación/vacío/error/reintento y respuestas tardías. Comprueba que no hay
  escritura en Storage ni texto en URL.
- 10 casos catalog-list.test.tsx: conserva los nueve comportamientos anteriores
  adaptados al nuevo contrato, español y diálogo de confirmación real del
  componente (el test antiguo aún esperaba window.confirm). Incluye permisos,
  401, manejo defensivo de FEATURE_NOT_ENTITLED sin introducir un gate, vacío,
  enlaces detalle/edición, filtros y desactivación solo tras confirmar. El caso
  adicional comprueba precio ausente y dígitos de USD. El diálogo usa métodos
  DOM simulados, sin presentar esto como evidencia de foco nativo real.
- 15 casos del nuevo proxy api/catalog/search/route.test.ts: cuerpo exacto,
  cookie staff/request ID y cancelación; no-store; rechazos de cuerpo/query,
  autoridad tenant, sesión ausente/solo Portal y estados upstream.
- 24 casos entre catalog-api.test.ts y proxy CRUD anterior
  api/catalog/[[...path]]/route.test.ts. GET y su transporte se preservan. Dos
  expectativas en inglés se alinearon con traducciones ya existentes del
  cliente; la implementación del cliente anterior no fue modificada.

Una aserción PYG se ajustó al espacio no separable que Intl usa entre moneda e
importe, sin modificar el formateador. Lint señaló String sobre BodyInit en un
mock; se reemplazó por un chequeo explícito del tipo string antes de JSON.parse.
Las correcciones no relajan reglas, permisos o criterios de aceptación.

La restauración es un remonte con el mismo QueryClient, no un Back/Forward
observado en navegador. Las respuestas HTTP de web son sintéticas. La prueba de
desactivación solo ejecuta un mock; no desactiva artículos demo o reales.

## Calidad y builds

TypeScript noEmit API/web aprobados, con build info web separado. Lint completo
API aprobado. Lint completo web y build final web con verificador de salida
aprobados con código 0.

Build API aprobado con outDir/tsBuildInfoFile temporales. Web copiada bajo
newsaas-ux011-build-FtZ2G1, con node_modules enlazado. Sin sobrescribir dist,
.next o tsconfig del desarrollo, sin detener/reiniciar procesos activos.
Advertencias informativas existentes de Next: plugin ESLint no detectado y
referencias TypeScript con soporte parcial; no se cambió esa configuración.

## Comandos reproducibles

Dependencias instaladas y PostgreSQL activo. Builds normales requieren una copia
o directorio de salida aislado cuando hay procesos dev usando .next/dist.

```powershell
$env:NODE_OPTIONS='--experimental-strip-types'
# Desde la raíz: migraciones exclusivamente en base aleatoria desechable.
node --env-file=.env scripts/verify-catalog-search.mjs
# Alternativa registrada en API:
pnpm --filter @newsaas/api test:catalog-search

# Desde apps/api:
node node_modules/vitest/vitest.mjs run src/catalog/catalog-search.integration.test.ts src/rbac/route-contract.probe.test.ts src/catalog/catalog.integration.test.ts src/catalog/catalog.repository.test.ts
node node_modules/eslint/bin/eslint.js 'src/**/*.ts' 'test/**/*.ts'
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit

# Desde apps/web:
node node_modules/vitest/vitest.mjs run 'src/app/(app)/app/catalog/catalog-search-list.test.tsx' 'src/app/(app)/app/catalog/catalog-list.test.tsx' 'src/app/(app)/app/catalog/catalog-api.test.ts' src/app/api/catalog/search/route.test.ts 'src/app/api/catalog/[[...path]]/route.test.ts'
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --tsBuildInfoFile .ux011.tsbuildinfo
```

## Revisión visual y límites

Sin nueva ronda de navegador, teclado real, lector de pantalla, Back/Forward
real, recorrido E2E con sesión real o certificación WCAG. Semántica de
controles, enlaces y estados verificada por componentes. No se presenta
simulación como validación visual o conexión completa del POS.

Texto español limitado al listado, confirmación y enlace de retorno, sin
declarar traducidos detalle/formularios/POS. Búsqueda por nombre, sin
SKU/barcode/categorías, fonética ni normalización especial de acentos. Orden
según collation PostgreSQL existente. Offset de hasta 10000 páginas no congela
resultados entre peticiones. Contexto aplicado en memoria por diez minutos desde
su última actualización, descartado al recargar/reingresar. No se usan URLs/logs
o almacenamiento persistente para el texto libre.

## Resultado final

| Gate                           | Resultado    | Frontera                                                                                   |
| ------------------------------ | ------------ | ------------------------------------------------------------------------------------------ |
| PostgreSQL real                | 11/11        | Servicio/SQL reales, permisos controlados, base temporal eliminada.                        |
| HTTP/guardas/regresión backend | 79/79        | 19 búsqueda + 25 inventario + 23 integración + 12 repositorio, con dobles.                 |
| Componentes/transporte/proxies | 60/60        | 11 contexto/listado + 10 regresión listado + 15 proxy nuevo + 24 cliente/proxy anteriores. |
| Tipos API/web                  | Aprobados    | TypeScript noEmit; build final también valida tipos.                                       |
| Lint completo API/web          | Aprobado     | Código 0; corrección del mock sin desactivar reglas.                                       |
| Builds API/web aislados        | Aprobados    | Copia/directorio temporal, outputs activos preservados.                                    |
| Verificador de salida web      | Aprobado     | Incluye /app/catalog y /api/catalog/search.                                                |
| Navegador/visual/E2E           | No ejecutado | Fuera del alcance de esta etapa.                                                           |

150 casos distintos aprobados, sin sumar reejecuciones. La última reejecución
web ejecutó solo la regresión del listado (10/10) después de corregir el mock;
los otros cincuenta casos ya estaban aprobados. El primer build web falló por
esa regla de lint en la copia anterior del test; el build final incluyó la
corrección, pasó y su verificador de salida terminó con código 0. UX-011 se
cierra como done dentro de sus criterios y del alcance automatizado acordado.
