---
type: qa
title: Validación del listado de ventas UX-009
status: active
created: 2026-10-29
updated: 2026-10-29
related_stories: [UX-009]
---

# UX-009 — Evidencia de consulta/listado de ventas

## Alcance y entorno

Sin navegador, cobros ni comandos financieros. Solo datos sintéticos en pruebas.
El árbol de trabajo estaba modificado al comenzar; se conservaron esos cambios.
Sin reset, limpieza del checkout, commit ni push. El PRD no fue editado en esta
etapa (su modificación local ya existía).

Node del host: 22.14.0. Vitest necesita
`NODE_OPTIONS=--experimental-strip-types` para importar la configuración
TypeScript compartida existente (TD-064). El lanzador pnpm intentó
comprobar/reinstalar dependencias y abortó por falta de TTY; no se autorizó
reinstalación. Se ejecutaron directamente los binarios ya instalados. El sandbox
bloqueaba la resolución de esbuild; las ejecuciones fuera del sandbox
funcionaron. No se instalaron dependencias ni cambiaron versiones.

Docker Desktop y PostgreSQL estaban detenidos. Se inició Desktop y únicamente el
servicio postgres, conservando el volumen existente. El aviso del nombre de
proyecto del volumen (newsaas/new_saas) no impidió el arranque. No se ejecutaron
seeds ni migraciones contra la base de desarrollo.

## PostgreSQL real — 8/8

`scripts/verify-sale-search.mjs` crea una base con nombre aleatorio
`newsaas_sale_search_test_<uuid>`, aplica todas las migraciones actuales y la
elimina en finally. `sale-search.pg.test.ts` rechaza nombres que no correspondan
al patrón temporal. La ejecución final salió con código 0; la base temporal fue
eliminada.

Se ejecutó el servicio real y Prisma/PostgreSQL; permisos/entitlements se
controlaron mediante dobles. Casos: límite 20 y página 2 sin duplicados, conteo
y proyección del tenant, empate de fechas por UUID, nombre de cliente incluso
inactivo sin distinguir mayúsculas, ausencia de resultados ajenos, UUID exacto,
privacidad sin customers.read, estados reales, vacío/página ajustada, orden
inverso y revalidación de permiso/entitlement. Una escritura sintética de estado
en otra conexión entre count y findMany comprobó el snapshot RepeatableRead.

Los fixtures son cabeceras sintéticas sin líneas ni efectos de negocio. Nunca se
llamó completar/cancelar, pagos, caja o inventario. La escritura concurrente
ocurrió exclusivamente en la base temporal; no afecta ventas demo ni reales. No
es una medición de rendimiento con grandes volúmenes.

## HTTP con dobles — 39/39

- 14/14 `sale-search.integration.test.ts`: aplicación y guardas reales, lectura
  sustituida; autenticación, sales.read, acceso sin customers.read, validación
  estricta, límites/tipos/campos inesperados y búsqueda fuera de logs.
- 25/25 `route-contract.probe.test.ts`: inventario completo y permisos, incluido
  POST /sales/search. Se reconciliaron seis rutas anteriores
  UX-003/UX-006/UX-008 que faltaban en el inventario y permisos clínicos
  múltiples exactos. No se eliminaron verificaciones ni se cambió comportamiento
  de los dominios.

Esta capa no se presenta como evidencia de SQL real; esa prueba es la anterior.

## Componentes, transporte y proxy

- 12/12 `sales-list.test.tsx`: POST al confirmar, filas del servidor sin
  filtrado local, metadatos de página, límites, reset por filtros/orden, remonte
  y contexto, expiración/nuevo QueryClient, errores 401/403/entitlement,
  reintento sin errores internos, búsqueda inválida, vacío y respuestas tardías.
- 24/24 proxy `api/sales/[[...path]]/route.test.ts`: contrato anterior más
  búsqueda aditiva; cuerpo exacto, ruta sin texto, no-store, rechazo de
  GET/query/tenant y sesión solo Portal. La prueba positiva de todas las rutas
  incluye POST search.
- 24/24 `sales-api.test.ts`: regresión del transporte existente y Decimal. Se
  corrigieron seis expectativas de textos que aún estaban en inglés; la
  implementación en español ya estaba en los cambios locales al iniciar.
- Retorno seguro: ver resultado final debajo. La nueva ruta history conserva
  únicamente el destino y elimina búsqueda, página y fragmentos.

Respuestas HTTP sintéticas; sin servicios de pagos externos. La restauración es
un remonte de componente en el mismo documento/QueryClient. No constituye
Back/Forward observado en navegador ni un recorrido E2E con sesión real.

## Calidad y builds

Lint completo de API/web y tipos API/web ejecutados directamente con ESLint y
TypeScript instalados. Builds aislados bajo el directorio temporal
`newsaas-ux009-build-tWaJDk`: API con outDir/tsBuildInfoFile separados y web
copiada con node_modules enlazado. No se sobrescribieron dist, .next ni tsconfig
del desarrollo. Primer build API/web y verificador de salida correctos; se
repitió el build tras el ajuste final de retorno seguro.

Advertencias informativas existentes de Next: referencias TypeScript y plugin
ESLint de Next no detectado. No se alteró esa configuración en esta Story.

## Comandos reproducibles

Con el runtime compatible y dependencias instaladas; PostgreSQL debe estar
activo. Los comandos de build normales requieren que no esté activo next dev
sobre el mismo .next; esta ejecución usó la copia temporal descrita arriba.

```powershell
$env:NODE_OPTIONS='--experimental-strip-types'
# Desde la raíz; runner crea y elimina exclusivamente su base temporal.
node --env-file=.env scripts/verify-sale-search.mjs
# Alternativa a través del comando agregado en API:
pnpm --filter @newsaas/api test:sale-search

# Desde apps/api:
node node_modules/vitest/vitest.mjs run src/sales/sale-search.integration.test.ts src/rbac/route-contract.probe.test.ts
node node_modules/eslint/bin/eslint.js 'src/**/*.ts' 'test/**/*.ts'
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit

# Desde apps/web:
node node_modules/vitest/vitest.mjs run 'src/app/(app)/app/sales/sales-list.test.tsx' 'src/app/api/sales/[[...path]]/route.test.ts' 'src/app/(app)/app/sales/sales-api.test.ts' src/lib/staff-return-path.test.ts
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --tsBuildInfoFile .ux009.tsbuildinfo
```

## Revisión visual y límites

No se abrió navegador ni se afirma revisión visual nueva, teclado real,
Back/Forward real, lector de pantalla o conformidad WCAG. Los componentes
verifican controles etiquetados, estados, enlaces y navegación semántica. El
listado omite montos/pagos/fiscal y se limita a datos existentes/autorizados. No
se cambió la aritmética ni se desplegó la aplicación; los procesos activos no se
detuvieron o reiniciaron para esta validación.

## Resultado final

| Gate                                 | Resultado        | Evidencia / frontera                                                   |
| ------------------------------------ | ---------------- | ---------------------------------------------------------------------- |
| PostgreSQL real                      | 8/8              | Servicio/Prisma reales, base temporal eliminada; permisos controlados. |
| HTTP y contratos/guardas             | 39/39            | 14 de búsqueda con lectura sustituida + 25 inventario/guardas.         |
| Componentes/proxy/transporte/retorno | 74/74            | 12 listado + 24 proxy + 24 cliente existente + 14 retorno seguro.      |
| Lint API/web completo                | Correcto, exit 0 | ESLint sobre todo el alcance de cada app.                              |
| Tipos API/web                        | Correcto, exit 0 | TypeScript noEmit; build info web separado.                            |
| Builds API/web finales               | Correcto, exit 0 | Copia/directorios temporales, sin modificar outputs activos.           |
| Verificador de salida web            | Correcto, exit 0 | Incluye la nueva ruta /app/sales/history.                              |
| Visual / E2E navegador               | No ejecutado     | Excluido según el alcance de esta etapa.                               |

121 casos distintos aprobados entre ejecuciones, sin sumar reejecuciones. El
último pase web ejecutó únicamente cliente y retorno (38/38), después de las
expectativas de idioma y la nueva ruta segura; los otros 36 ya habían pasado. El
último build recoge los ajustes finales de UI/retorno y pruebas. UX-009 se
cierra como done dentro de sus criterios y del alcance automatizado acordado.
