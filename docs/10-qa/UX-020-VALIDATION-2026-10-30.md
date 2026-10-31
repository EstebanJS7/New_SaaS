---
type: qa
status: passed
story: UX-020
date: 2026-10-30
updated: 2026-10-30
---

# UX-020 — Concurrencia de correcciones clínicas

## Alcance y entorno

Windows/PowerShell, main. UX-020 disponible verificado y creada in-progress
antes de implementar. Contexto cargado: AGENTS y governance, UX-015–019,
UX-018/019 QA, TD-066, Clinical, guía UX/UI, PRD §§9/12.1/13/41 y decisiones
DEC-080/084 y ADR-001. Cambios locales UX-019 y previos preservados; sin reset,
limpieza de Git, commit/push o PRD alterado. No dependencias nuevas.

Solo correcciones PUT de tratamientos, estudios y pesos. No historial,
recuperación durable, consultas cerradas, vacunas/desparasitación, Portal,
vínculos clínicos, finanzas o inventario. Visual/E2E pospuesto por alcance
autorizado. Se revalidan idempotencia POST y recuperación temporal.

## Contrato y persistencia

Migración 20261030000003_clinical_record_version: columna version integer
positiva NOT NULL DEFAULT 1 en los tres registros; trigger BEFORE UPDATE que
asigna OLD.version + 1. Inicialización técnica, sin conversión/backfill de
contenido/unidades. Version asociada a datos clínicos CONFIDENTIAL; sin nuevos
logs, exports, Portal ni retención destructiva. Baseline sigue diez minutos en
memoria del documento, nunca Storage/URLs/persistencia del navegador.

Detalle staff incluye version en el mismo SELECT scoped de los campos clínicos.
Las listas y respuestas de comandos mantienen DTO legado. PUT acepta
expectedVersion opcional entero 1..2147483647; SELECT FOR UPDATE y validación,
update, incremento por trigger y auditoría bajo la misma transacción
ReadCommitted. Mismatch: 409 CONFLICT / Clinical record version changed. Ajeno,
inexistente o paciente incorrecto: mismo 404, sin exponer versión ni efectos.
No-op vacío: comprueba token, sin incremento/auditoría. Campos presentes aunque
repitan valores avanzan versión y auditan.

Transición compatible: PUT sin expectedVersion sigue funcionando sin CAS para
ese escritor, pero avanza versión para clientes nuevos. Un escritor legado puede
sobrescribir cambios: protección global requiere migración explícita de esos
consumidores. La UI nueva exige versión válida; no cae a PUT sin token. Una API
anterior estricta rechaza el nuevo campo antes de escribir. No-op no es
historial; versión no demuestra quién ganó una respuesta incierta.

## Pruebas simuladas/estáticas — 505 casos distintos aprobados

API: 127 en seis archivos. clinical.http.integration.test.ts,
clinical.records.service.test.ts, route-contract.probe.test.ts y las tres suites
integration de treatment/study/weight-search. Guards Nest/Fastify reales con
persistencia simulada: sesión/membresía/staff, granularidad, veterinary,
autoridad tenant y validación estricta. Nuevos casos HTTP rechazan tokens
cero/negativo/fraccionario/string/null/overflow antes de escribir. Fixtures de
detalle extendidas con versión explícita, sin relajar permisos ni cuerpos.

Web: 363 en dieciocho archivos de una corrida final (76,64 s):

- clinical-correction-concurrency.test.tsx, 9. Matriz de tres tipos: PUT con
  expectedVersion original; conflicto entre prelectura/guardado conserva inputs,
  bloquea reenvío y permite GET actual sin otro PUT; prelectura con versión
  distinta y valores iguales bloquea; sin versión no hay fallback sin CAS.
- clinical-record-recovery.test.tsx, 67. Baseline con versión preservada,
  conflicto aunque los campos coincidan, copia separada, autorización fresca,
  expiración, aislamiento por paciente/tipo/documento y todas las regresiones
  UX-018/019: claves exactas de creación, pesos GET-only, pending/uncertain PUT,
  resultados tardíos y limpieza por generación.
- treatment/study/weight-form, 50. Campos parciales más expectedVersion,
  contexto null, resultado vacío, precisión, unidad desconocida/KG, fecha
  original con segundos/milisegundos, fechas editadas de Paraguay, revisión,
  confirmación, errores y doble clic.
- treatment/study/weight-list, 59; clinical-workspace, 47;
  staff-session-boundary, 7; patient-detail, 10. Regresión de listas, consultas,
  sesión y ficha, sin modificación de invariantes.
- correction-concurrency proxy, 6. Body exacto, cookie staff, private/no-store,
  409 conservado y sin AbortSignal en comandos; expectedVersion no llega a
  POST/create/search. creation-idempotency proxy, 6: contrato UX-019 intacto.
- treatment/study/weight-write proxy, 66; route, 19; weight-read, 17.

Database: schema-clinical.test.ts, 15 invariantes estáticas. Las nuevas
columnas/triggers se verifican ejecutando migraciones y servicios sobre PG. No
se suman reejecuciones como casos nuevos. Vitest instalado con
NODE_OPTIONS=--experimental-strip-types, desde el paquete correspondiente y
archivos explícitos. Simulación de fetch/navegación/reloj no certifica visual,
lector de pantalla o sesión real desplegada.

## PostgreSQL real desechable — 93 casos distintos aprobados

Contenedor aislado newsaas-ux020-disposable-pg, postgres:16-alpine, puerto local
55440 y tmpfs sin volúmenes del proyecto. Usuario/contraseña sintéticos.
DATABASE_URL reemplazada solo para procesos de prueba. Cada runner valida un
nombre de base aleatoria, crea esa base, aplica todas las migraciones y elimina
solo esa base en finally. Sin .env modificado ni migración/lectura de registros
sobre base configurada/de desarrollo u operativa. Sin seeds operativos.

- node scripts/verify-clinical-correction.mjs: 26. Prisma,
  ClinicalRecordsService/AuditWriter y detalles staff reales. Por tipo:
  inicialización y DTOs legados, corrección con versión incrementada,
  solicitudes simultáneas con un ganador/409 y una auditoría, respuesta de PUT
  confirmada descartada seguida de retry obsoleto sin otra escritura/auditoría,
  cambios legados incluso con valores iguales que invalidan el baseline,
  rollback de contenido/versión ante fallo de auditoría y retry del mismo
  baseline, organización/paciente ajeno sin efectos, update/veterinary y una
  carrera con barrera que retiene un lock de fila real mientras otro escritor
  intenta corregir. Además: validación estricta en servicio y no-op vacío.
- node scripts/verify-clinical-creation.mjs: 25. Regresión UX-019 de recibos,
  snapshot original después de correcciones, carreras, aislamiento, permisos,
  auditoría única y rollback de registro/recibo/auditoría.
- node scripts/verify-weight-entry.mjs: 12. Decimal(10,3), unidad conocida/
  desconocida, DTOs legados, correcciones legadas auditadas y rollback.
- node scripts/verify-treatment-search.mjs, verify-study-search.mjs y
  verify-weight-search.mjs: 10 cada uno, 30 total. Detalle con versión del mismo
  snapshot, paginación, orden, conteos, rangos/unidades y aislamiento.

En las seis ejecuciones finales pasaron pruebas y limpieza de su base. Al
terminar se verificó que no quedaban bases newsaas_* y se detuvo el contenedor
--rm; el contenedor temporal quedó eliminado. La pérdida de respuesta se simula
descartando una respuesta ya confirmada; no se afirma un corte de socket HTTP
real. La transacción/lock, trigger, aislamiento y rollback sí son PostgreSQL
real; guards HTTP se verifican por separado arriba.

## Lint, tipos, Prisma y builds — aprobados

ESLint instalado: completo API desde apps/api (src/**/\*.ts y test/**/*.ts), y
completo web desde apps/web. TypeScript --noEmit API/web/database; web usa
.ux020.tsbuildinfo y database build-info temporal. Builds API/database con
outDir y tsBuildInfoFile temporales. Prisma validate/generate sobre copia de
esquema, con cliente nuevo generado solo en el temporal; no se reemplazan
src/generated/dist usados por dev.

Directorio aislado:
C:/Users/esteb/AppData/Local/Temp/newsaas-ux020-build-BQYMbA. Build Next con
fuentes/configuración/setup de tipos copiados y node_modules enlazado: salida 0
y scripts/verify-build-output.mjs aprobado. Sin reutilizar .next/dist activos o
reiniciar procesos. Avisos informativos previos de Next sobre referencias
TS/plugin ESLint conservados, sin desactivar reglas. Formato y git diff --check
verificados; PRD sin diff.

## Hallazgos corregidos

Fixture inicial WeightDetail era alias y no interface: se corrigió la extensión
de DTO antes de validar tipos. Fixtures backend/front de detalle agregan la
versión; expectativas de PUT se extendieron con expectedVersion conservando
igualdad exacta y campos omitidos. Primeras pruebas tenían doce expectativas de
body anterior: se actualizaron al contrato autorizado. Un parámetro de prueba no
usado se renombró, sin ocultar fallos. Preflight de peso compara versión, no
solo cantidad/unidad/fecha. Todas las suites finales aprobaron.

No se reconstruyen tipos desde comparaciones de valores ni se actualiza el
baseline automáticamente. Version, contenido y auditoría se revierten juntos.
Lecturas SQL acotadas permiten probar sin cambiar clientes generados activos. No
hace falta nueva dependencia, servicio o framework compartido.

## Límites

Sin navegador/Playwright/E2E, accesibilidad visual/lector, Back/Forward o sesión
desplegada real. No despliegue ni migración operativa. TD-066 permanece open
para historial, recuperación durable, revisión visual/E2E y migración
obligatoria de escritores legados sin token. PUT incierto sigue bloqueado y la
versión no prueba éxito por coincidencia de valores. Sin commit/push.
