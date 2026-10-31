---
type: qa
status: passed
story: UX-022
date: 2026-10-30
updated: 2026-10-30
---

# UX-022 — Consumidores de escritura clínica protegida

## Resultado y alcance

UX-022 done para inventario/endurecimiento local y plan compatible. 407 pruebas
distintas aprobadas: 327 frontend/proxy, 29 backend simuladas, 51 PostgreSQL
real. No se suman reejecuciones. Campos en API/BFF siguen opcionales: no se
declara garantía global de consumidores externos o retiro del contrato legado.
DEC-085 sigue proposed y TD-066 open.

Contexto: AGENTS, engineering/documentation rules, Story start, UX-019/020/021,
Clinical/TD-066, PRD §§9/12.1/13/28/41, DEC-084 y ADR-001. IDs UX-022/DEC-085
disponibles verificados; Story creada in-progress antes del código, main. Sin
PRD, dependencias, schema/migración nuevos, commit/push o limpieza de cambios.

## Inventario y comportamiento comprobado

Inventario de nombres de comandos, rutas concretas/dinámicas y escrituras Prisma
en apps/packages/scripts; invocaciones inspeccionadas. Tabla y rutas en Story.
Tres consumidores productivos locales: formularios staff de tratamiento, estudio
y peso. Ya enviaban guardias, pero helpers opcionales permitían omitirlas por
accidente. No se inventa otro consumidor para migrar. Fixtures/demo directos no
se ejecutaron ni se convirtieron en comandos operativos. Ausencia de código
local no es ausencia de integraciones externas.

Helpers exigen por overload creación con intento caller-owned y corrección con
expectedVersion original. Antes de fetch validan clave UUID o entero positivo
1..2147483647 y rechazan mezcla de modos. INVALID_WRITE_GUARD es local, status
0/uncertain false, sin contenido ni petición. No generan nueva clave, refrescan
versión, hacen fallback o retry. Formularios invocan el modo correcto;
recuperación conserva comando/clave/baseline. Backend sigue siendo autoridad de
permisos/tenant/veterinary, no los tipos o estas guardias UX.

Peso con savedId confirmado toma primero el camino GET-only incluso si su clave
antigua es inutilizable. Fallo de lectura no provoca POST; unidad se obtiene de
la proyección staff y no se infiere de cantidad/DTO legado. No se cambia
precisión, fechas, formato es-PY, UX de corrección o bloqueo de PUT incierto. No
hay nuevo markup, copy o persistencia de navegador.

## Simulación — 356 casos

Binarios instalados, sin pnpm/reinstalación. Desde apps/web, con
NODE_OPTIONS=--experimental-strip-types:

    node node_modules/vitest/vitest.mjs run --config vitest.config.ts "src/app/(app)/app/patients/[id]/clinical-write-contract.test.ts" "src/app/(app)/app/patients/[id]/treatment-form.test.tsx" "src/app/(app)/app/patients/[id]/study-form.test.tsx" "src/app/(app)/app/patients/[id]/weight-form.test.tsx" "src/app/(app)/app/patients/[id]/clinical-record-recovery.test.tsx" "src/app/(app)/app/patients/[id]/clinical-correction-concurrency.test.tsx" "src/app/api/clinical/[[...path]]"

Resultado 327 passed, 15 archivos, 45,36 s. Log local Temp/ux022-web-tests.log.

- 52 casos nuevos de contrato: falta/valor inválido de clave o versión antes de
  cualquier fetch, mezcla de modos rechazada, reintento explícito con misma
  clave/comando tras red fallida, versión máxima sin reemplazar baseline y peso
  confirmado con lectura fallida GET-only. Reejecución final 52/52 en 4,79 s
  tras corregir lint de mocks; no se suma otra vez.
- Siete llamadas negativas @ts-expect-error verifican que tsc rechaza omitir
  intento/versión y mezclar modos. La función de ejemplo nunca se invoca; no se
  cuentan como pruebas runtime adicionales.
- Regresión de formularios: tratamiento 15, estudio 18 y peso 17; recuperación
  67, concurrencia UI 9. Conservación de valores/precisión, clave/baseline,
  errores inciertos y lectura post-commit.
- Proxy 149: contratos de lectura/escritura, cookies staff, allowlist, no-store,
  errores y reenvío de protección. Tres casos nuevos mantienen cuerpos POST/PUT
  legados sin fabricar clave/versión; DTO/estado upstream intactos.

Backend: clinical.http.integration.test.ts (16) y
clinical.records.service.test.ts (13), 29/29 en 13,66 s. Nest/guards reales con
base-fixture simulada; validación, permisos granulares, membresía/aislamiento y
contratos legados. No se presentan estos 29 como persistencia PostgreSQL.

## PostgreSQL real desechable — 51 casos

Contenedor propio postgres:16-alpine, tmpfs, puerto loopback aleatorio y
credenciales exclusivamente sintéticas. No lectura/migración de base configurada
o de desarrollo. Se conectó al catálogo postgres de ese contenedor nuevo solo
para crear/eliminar DB de prueba con nombres guardados por regex. Scripts
existentes ejecutados con DATABASE_URL apuntando exclusivamente a él:

    node scripts/verify-clinical-creation.mjs
    node scripts/verify-clinical-correction.mjs

Cada script crea su DB newsaas_clinical_creation_test_<uuid> o
newsaas_clinical_correction_test_<uuid>, aplica las migraciones existentes,
corre su suite y elimina esa DB. Finalmente el harness elimina el contenedor
propio. Sin seed demo, servicios externos, Redis, navegador o procesos de
desarrollo.

25/25 creación (3,09 s): commit cuya respuesta se descarta, replay de snapshot,
solicitudes simultáneas iguales/incompatibles, auditoría/recibo únicos,
tenant/paciente/tipo, permisos/entitlement actuales, rollback, FK/inmutabilidad,
normalización exacta y unidades. Mantiene explícitamente creación sin clave no
deduplicada: no se oculta esa frontera migrando todos los fixtures.

26/26 corrección (2,73 s): versiones/DTO, un ganador y conflicto, respuesta
perdida, escrituras legadas avanzan versión, no-op, lock real de fila,
aislamiento/permisos/veterinary y rollback de contenido/versión/auditoría. PUT
sigue sin idempotencia: no se añade un reintento automático porque tenga token.

Artefactos sintéticos locales:
C:/Users/esteb/AppData/Local/Temp/newsaas-ux022-Kf0mRJ/{pg-creation,pg-correction,api-tests}.log.
No se agregan resultados/traces/credenciales a Git.

## Lint, tipos y builds aislados

ESLint web completo aprobado (node node_modules/eslint/bin/eslint.js .).
Typecheck web aprobado con tsc --noEmit y tsBuildInfoFile en Temp; también
compila las llamadas negativas. API tsc/build en directorio temporal propio
aprobado. No se reemplazó ningún dist/cliente Prisma o output de dev.

Next build en copia temporal de src/config/public/scripts con junction a
node_modules instalados y sin copiar .env. NEXT_PUBLIC_API_URL fijada a
127.0.0.1:1, sin usar API activa ni proveedor externo. web-build-final.log y
web-output-final.log aprobados, incluido verificador
scripts/verify-build-output.mjs. No cambio de database/schema, por lo que no se
genera cliente Prisma nuevo.

La primera compilación encontró cuatro errores de lint en el nuevo test: async
mocks sin await y String(body) no seguro. Corregidos usando Promise.resolve y
comprobando body string antes de JSON.parse; lint completo, tipos, 52 casos y
build/verificador web reejecutados y aprobados. Se conservan logs del fallo y
del resultado final; no se repite PG/backend ya verde ni se suman repeticiones.
El contenedor PG se retiró incluso al fallar aquel build.

## Límites y clasificación

Sin nueva ronda visual/E2E porque no cambió markup, copy o flujo. UX-021 es
evidencia previa y no se presenta como ejecutada de nuevo; no se certifican
Safari/Firefox, dispositivo físico, lector de pantalla, despliegue o CI.

No nuevos campos persistentes ni telemetría. Claves/versiones/recibos siguen
CONFIDENTIAL por asociación clínica. Errores constantes sin contenido, sin datos
clínicos en URL/log/Storage ni nueva retención destructiva. Inventario y
propuesta no contienen información operativa. API/BFF siguen opcionales; DEC-085
no está aceptada ni activa un corte incompatible. TD-066 permanece open para
corte global, historial y recuperación durable. Sin tocar consultas cerradas,
vacunas/desparasitación, Portal, vínculos, finanzas o inventario.
