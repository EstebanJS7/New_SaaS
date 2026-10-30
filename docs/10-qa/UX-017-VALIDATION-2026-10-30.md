---
type: qa
status: passed
story: UX-017
date: 2026-10-30
updated: 2026-10-30
---

# UX-017 — Pesos en kg: entrada, corrección y unidad explícita

## Entorno y alcance

Windows/PowerShell, main. Cambios acumulados conservados, sin commit/push,
dependencias nuevas, seeds o mutaciones sobre datos operativos. DEC-084 aceptada
y PRD §12.1 aprobado previamente: no se amplió silenciosamente. Cantidad, unidad
y fechas clínicas CONFIDENTIAL, sin contenido en URL/logs/Storage persistente.

Cambio de esquema reproducible: enum ClinicalWeightUnit KG y unit nullable,
migración 20261030000001_clinical_weight_unit. Sin default, UPDATE, backfill o
conversión de cantidades. No hay base productiva que convertir según producto;
no se aplicó esta migración en la base configurada/de desarrollo. Solo las bases
desechables de las pruebas recibieron migraciones. Para ejecutar contra una base
existente deberá desplegarse el esquema por el proceso habitual.

## Pruebas simuladas y esquema — 253 aprobadas

API, 81 pruebas distintas de la última ejecución por archivo:

- clinical.http.integration.test.ts: 10, cadena staff/membresía/permisos.
- route-contract.probe.test.ts: 25, inventario exacto de rutas/permisos.
- clinical.records.service.test.ts: 13, regresión de registros/auditoría.
- weight-search.integration.test.ts: 33, detalle/consulta, validación exacta de
  unit y rangos, private,no-store, aislamiento/autorización simulados.

Web, 157 pruebas:

- weight-form.test.tsx: 17. Crear solo tras confirmar, KG explícito, decimal
  máximo exacto/coma, atribuir KG manualmente, fecha sola desconocida, conservar
  instante, actualización parcial, validación, conflicto visible, revisión/
  descarte, doble clic y respuesta incierta; fallo de relectura tras comando
  bloquea reenvío y no deduce unidad del DTO legado.
- weight-list.test.tsx: 28. Lectura/contexto/filtros, bloqueo de rango sin
  unidad, KG conocido y desconocido sin inferencias, estados y navegación de
  componentes.
- patient-detail.test.tsx: 10. Regresión de ficha.
- weight-write.test.ts: 22, treatment-write.test.ts: 22 y
  study-write.test.ts: 22. Proxy: bytes/body exactos, cookie staff, claves/query
  ajenas rechazadas, private,no-store y comandos sin AbortSignal.
- weight-read.test.ts: 17 y route.test.ts: 19. Regresión de proxy/lecturas.

Database: schema-clinical.test.ts, 15 pruebas estáticas de invariantes clínicas.
Estas 253 pruebas no certifican PostgreSQL, HTTP de producción ni experiencia
visual real. Binarios Vitest instalados, desde apps/api, apps/web y
packages/database, con archivos explícitos y
NODE_OPTIONS=--experimental-strip-types.

## PostgreSQL real desechable — 22 aprobadas

Desde raíz, node --env-file=.env scripts/verify-weight-entry.mjs: 12 pruebas.
node --env-file=.env scripts/verify-weight-search.mjs: 10 pruebas de regresión.
Cada runner crea base aleatoria validada newsaas_weight_*_test_<uuid>, aplica
migraciones, usa datos sintéticos y elimina exclusivamente esa base en finally.
Ambas ejecuciones finalizaron con salida 0, incluida la limpieza.

Prisma, ClinicalRecordsService y AuditWriter reales. Cubre cantidad exacta y KG,
DTOs legados sin unidad, creación desconocida, atribuir solo KG sin cambiar
cantidad/instante, cantidad legada que vuelve desconocida, fecha sola que
conserva KG, rangos homogéneos y contrato legado, no-op, permisos/entitlement,
tenant/paciente ajeno sin efectos, auditoría mínima y rollback de crear/corregir
ante falla de auditoría. Regresión de paginación/orden/conteos y detalle seguro.
No son una sesión HTTP real ni una migración sobre datos de producción.

## Lint, tipos, esquema y builds — aprobados

Lint completo API/web con binarios ESLint instalados. Tipos API/web/database con
TypeScript --noEmit y tsBuildInfoFile separado cuando corresponde. Prisma
validate y generate aprobados; cliente generado copiado por el script existente,
sin instalación de dependencias ni archivos generados añadidos a Git.

Build API y database con tsc --outDir/--tsBuildInfoFile bajo directorio
temporal. Build Next con fuente copiada y node_modules enlazado bajo
C:/Users/esteb/AppData/Local/Temp/newsaas-ux017-build-iP0Mti/web: salida 0, 29
páginas estáticas generadas; scripts/verify-build-output.mjs aprobado. No se
reutilizó .next/dist activo ni se reiniciaron procesos de desarrollo. Formato y
git diff --check aprobados al cierre; PRD se excluyó de reformateo masivo para
preservar únicamente la definición aprobada.

## Incidencias de verificación corregidas

El primer chequeo de tipos señaló fixture de detalle sin unit: se agregó null.
Tres expectativas iniciales de PostgreSQL conservaban texto de plantilla o
comparaban Decimal con string: se corrigieron a cantidad exacta y toString, sin
floats; las 12 pruebas aprobaron. Dos expectativas de listado asumían que
seleccionar unidad no consultaba: se comprobó la última petición correcta y el
conteo real de lecturas, conservando el rechazo de rangos inválidos. La suite
final web aprobó 157/157. No se suman repeticiones como casos nuevos.

Una repetición final de Vitest no arrancó por acceso denegado de esbuild al
resolver configuración dentro del sandbox. Se repitió con acceso ampliado al
mismo comando acotado: 33 HTTP + 13 servicio aprobadas. No se ocultó fallo de
producto ni se modificaron permisos de aplicación para superar la comprobación.

## Límites explícitos

Sin navegador/revisión visual, Playwright/E2E o rol real desplegado. Claims
frontend conocidos ocultan acciones; shell actual no los suministra y API sigue
siendo autoridad. Sin CAS/ETag, idempotencia POST, historial anterior de valores
o recuperación de borrador tras desmontaje/recarga/Back-Forward. Prelectura no
cierra carrera GET→PUT. Respuesta perdida o relectura fallida tras commit exige
revisión manual, sin retry. TD-066 sigue open e incluye seguimiento visual/E2E.
TD-055 cierra la falta funcional de formularios, sin certificar esos pendientes.

275 casos distintos aprobados: 253 simulados/esquema y 22 PostgreSQL real. Sin
cobros, finanzas, stock, consultas cerradas, Portal, conversiones o gráficos.
