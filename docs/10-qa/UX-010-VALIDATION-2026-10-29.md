---
type: qa
title: Validación de búsqueda paginada de clientes UX-010
status: active
created: 2026-10-29
updated: 2026-10-29
related_stories: [UX-010]
---

# UX-010 — Evidencia del listado de clientes

## Alcance y entorno

Se implementó POST /customers/search y se conectó el listado existente. Se
preservaron GET /customers, DTOs/paquetes compartidos, proxy CRUD, comandos,
contactos/direcciones y consumidores de Customers. Sin migraciones, nuevas
columnas, dependencias, permisos, entitlement o cambios de PRD. El PRD y muchos
otros archivos ya estaban modificados al comenzar; no se limpiaron ni
restauraron. Sin commit ni push.

Node del host 22.14.0; Vitest requiere NODE_OPTIONS=--experimental-strip-types
para importar la configuración TypeScript compartida (entorno ya documentado en
TD-064). Se invocaron directamente TypeScript, ESLint, Vitest y Next instalados;
no se llamó al lanzador pnpm ni se reinstalaron dependencias. Las pruebas y
builds necesitaron ejecución fuera del sandbox por las restricciones conocidas
de resolución de esbuild.

PostgreSQL estaba saludable en Docker, puerto 5433. No se reinició el contenedor
ni se cargaron seeds demo. La comprobación real creó exclusivamente una base
aleatoria temporal y la eliminó al terminar. No se abrió navegador ni se hizo un
cobro o una mutación financiera.

## PostgreSQL real — 11/11

`node --env-file=.env scripts/verify-customer-search.mjs` salió con código 0. El
runner crea `newsaas_customer_search_test_<uuid>`, aplica las migraciones
actuales solamente allí y elimina esa base en finally. El test valida el nombre
antes de conectar. No aplica migraciones a la base demo/desarrollo.

`customer-search.pg.test.ts` usa el servicio y Prisma/PostgreSQL reales;
PermissionResolver está controlado por el test. Casos distintos:

- Página limitada a 20, segunda página, total solo del tenant, sin duplicados y
  desempate por UUID con nombres/fechas repetidos; proyección mínima exacta.
- Cuatro campos buscables existentes sin distinguir mayúsculas: nombre visible,
  razón social, documento y RUC. Los dos identificadores no aparecen en las
  filas.
- Aislamiento de los OR de búsqueda; nombre/documento ajenos no devuelven filas.
  No busca valores de contactos.
- Combinación de tipo y estado con conteo exacto, incluyendo inactivos y todos.
- Ajuste de página fuera de rango y vacío coherente.
- Orden por creación reciente con desempate UUID.
- Revalidación de customers.read en el servicio.
- Una actualización sintética de isActive desde otra conexión, intercalada entre
  count y findMany, demuestra el snapshot RepeatableRead consistente.

Solo fixtures sintéticos de clientes/contactos dentro de la base temporal. Esa
actualización concurrente no es una acción sobre clientes demo o reales. No se
usaron servicios externos ni comandos de pago, ventas, caja, inventario o
clínica. No es un benchmark de grandes volúmenes ni una sesión de resultados
congelada.

## HTTP y guardas con dobles — 44/44

- 19/19 `customer-search.integration.test.ts`: aplicación y guardas reales,
  lectura sustituida para aislar autenticación, membresía activa,
  customers.read, rechazo de Portal con sesión viva, validación
  estricta/defaults y texto fuera de logs.
- 25/25 `route-contract.probe.test.ts`: inventario completo con la nueva ruta
  declarada. La incorporación de UX-010 agrega una única ruta a la versión ya
  reconciliada en UX-009. No cambia permisos/guardas de otros dominios.

La prueba HTTP no se presenta como SQL real. El comportamiento SQL está
verificado por separado en los once casos de PostgreSQL.

## Regresión de Customers con dobles — 28/28

- 15/15 `customers.service.test.ts` conserva los contratos y reglas previos.
- 13/13 `customers.integration.test.ts` conserva las lecturas y CRUD
  autorizados, incluyendo aislamiento de las entidades previas sobre el harness
  simulado.

La ejecución final del dominio sumó 47/47 (19 búsqueda + 28 existentes). Las
mutaciones de esta regresión ocurrieron solo sobre el doble en memoria, no sobre
PostgreSQL ni datos operativos. Sin regresión financiera de POS.

## Componentes y proxies con respuestas sintéticas — 31/31

- 11/11 `customer-search-list.test.tsx`: búsqueda solo al confirmar y filas del
  servidor, metadatos de página/límites, reset por estado/orden/tipo,
  restauración de búsqueda/estado/tipo/orden/página mediante remonte,
  expiración/nuevo cliente, validación, vacío, error y reintento en español, y
  descarte de respuestas tardías. Comprueba ausencia de escrituras en Storage y
  texto fuera de URL.
- 2/2 `customers-list.test.tsx`: estados 401 y 403; las expectativas anteriores
  en inglés se actualizaron para el listado ahora traducido.
- 15/15 `api/customers/search/route.test.ts`: cuerpo exacto, cookie staff y
  request ID, ausencia de autoridad tenant, señal de cancelación, no-store,
  cuerpo inválido, query rechazada, falta de sesión/solo Portal y estados
  upstream.
- 3/3 proxy CRUD anterior `api/customers/[[...path]]/route.test.ts`, sin cambios
  en su implementación.

La restauración es un remonte de componente con el mismo QueryClient, no una
sesión de Back/Forward observada en navegador. Cada request del listado se
comprueba como POST de lectura; no dispara comandos de mutación.

## Tipos, lint y builds

Tipos API/web aprobados con TypeScript noEmit, usando un archivo de build info
web separado. Lint completo API aprobado. El primer lint/build web detectó
no-unsafe-assignment en un matcher del test del proxy; se reemplazó por la señal
exacta del Request tipado y se repitieron test/lint/build afectados sin relajar
reglas.

API build aprobado con outDir y tsBuildInfoFile en el directorio temporal
`newsaas-ux010-build-SuOqP6`. Web se compiló desde una copia del proyecto con
node_modules enlazado, en ese mismo directorio temporal. No se sobrescribieron
dist, .next o tsconfig de desarrollo ni se detuvieron/reiniciaron procesos
activos. El lint web final, build web y verificador de salida aprobaron con
código 0.

Advertencias informativas existentes: plugin ESLint de Next no detectado y
referencias TypeScript con soporte parcial. No se cambió esa configuración.

## Comandos reproducibles

Con dependencias instaladas y PostgreSQL activo. Los builds normales deben usar
una copia/directorio de salida aislado si hay procesos dev activos.

```powershell
$env:NODE_OPTIONS='--experimental-strip-types'
# Desde la raíz: base PostgreSQL temporal, nunca reset/seed de desarrollo.
node --env-file=.env scripts/verify-customer-search.mjs
# Comando equivalente registrado en API:
pnpm --filter @newsaas/api test:customer-search

# Desde apps/api:
node node_modules/vitest/vitest.mjs run src/customers/customer-search.integration.test.ts src/rbac/route-contract.probe.test.ts src/customers/customers.service.test.ts src/customers/customers.integration.test.ts
node node_modules/eslint/bin/eslint.js 'src/**/*.ts' 'test/**/*.ts'
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit

# Desde apps/web:
node node_modules/vitest/vitest.mjs run 'src/app/(app)/app/customers/customer-search-list.test.tsx' 'src/app/(app)/app/customers/customers-list.test.tsx' src/app/api/customers/search/route.test.ts 'src/app/api/customers/[[...path]]/route.test.ts'
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --tsBuildInfoFile .ux010.tsbuildinfo
```

## Revisión visual y límites

No se ejecutó una nueva ronda de navegador, revisión visual, teclado real,
Back/Forward real, lector de pantalla ni auditoría WCAG. No se certifica el
recorrido completo con una sesión real a partir de mocks/componentes. El listado
consume tokens semánticos y usa controles etiquetados/estados accesibles.

La traducción se limita al listado y su confirmación/enlace de retorno; detalle,
formularios y Portal quedan con su alcance anterior. No hay búsqueda por
contactos/direcciones, normalización especial de documentos, búsqueda fonética o
collation es-PY añadida. Paginación offset 1–10000, veinte por página; nombres
ordenados según la collation existente de PostgreSQL. El estado aplicado dura
diez minutos desde su última actualización y se descarta tras recargar o entrar
otra vez.

## Resultado final

| Gate                          | Resultado    | Frontera                                                                 |
| ----------------------------- | ------------ | ------------------------------------------------------------------------ |
| PostgreSQL real               | 11/11        | Base temporal eliminada; SQL/servicio reales, permisos controlados.      |
| HTTP y guardas                | 44/44        | 19 búsqueda con lectura sustituida + 25 inventario/guardas.              |
| Regresión Customers           | 28/28        | 15 servicio + 13 integración con dobles en memoria.                      |
| Web y proxies                 | 31/31        | 11 listado + 2 errores previos + 15 proxy nuevo + 3 proxy CRUD anterior. |
| Tipos API/web                 | Aprobados    | NoEmit; build info web separado.                                         |
| Lint API/web completo         | Aprobado     | Código 0; corrección del matcher sin desactivar reglas.                  |
| Builds API/web                | Aprobados    | Directorio/copia temporal; outputs activos preservados.                  |
| Verificador de salida web     | Aprobado     | Incluye /api/customers/search y /app/customers.                          |
| Navegador/revisión visual/E2E | No ejecutado | Fuera del alcance de esta etapa.                                         |

114 casos distintos aprobados, sin sumar reejecuciones. La última reejecución
web fue solo el proxy nuevo (15/15) tras la corrección tipada; los otros 16
casos ya estaban aprobados. El build final incluye el test corregido. UX-010
queda done dentro de los criterios automatizados acordados.
