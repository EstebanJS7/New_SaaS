---
type: qa
status: passed
story: UX-019
date: 2026-10-30
updated: 2026-10-30
---

# UX-019 — Idempotencia de creaciones clínicas

## Entorno y alcance

Windows/PowerShell, main. Git apareció limpio al iniciar; se conservaron
archivos y comportamiento de las etapas anteriores, sin reset, limpieza, commit
o push. Contexto revisado: AGENTS/governance, guía UX/UI, UX-015–018 y QA,
TD-066, Clinical, PRD §§9/12.1/13/41, DEC-067/080/084 y ADR-001. UX-019
disponible. No cambios del PRD ni dependencias nuevas. No navegador por alcance
autorizado.

Contrato elegido: idempotencyKey UUID opcional en JSON, nunca en URLs/headers.
Una API antigua estricta rechaza el campo antes de escribir; evita asumir que
una cabecera ignorada brinda protección. Cuerpos sin clave y respuestas legadas
intactos. Solo POST de treatments/studies/weights; PUT y otras capacidades fuera
de alcance. DTO legado de peso sin unidad, con relectura staff autoritativa.

Recibo ClinicalCreationReceipt CONFIDENTIAL: ámbito, UUID asociado a operación,
digest SHA-256 no anonimizado, snapshot de respuesta y fecha. Sin Portal,
exports nuevos, logging de contenido, Storage ni purga automática. No se aplica
una política destructiva de retención. Copia UX-018: diez minutos por documento;
clave/comando/ID confirmado incluidos. Ver Clinical para semántica detallada.

## Simulación automatizada — 484 pruebas distintas aprobadas

API: 124 casos en seis archivos: clinical.http.integration.test.ts,
clinical.records.service.test.ts, route-contract.probe.test.ts y las suites
integration de treatment/study/weight-search. HTTP usa Nest/Fastify y guards
reales con persistencia simulada. Incluye campo de clave inválido, rechazo de
clave en PUT, falta de sesión, permisos granulares, entitlement y aislamiento
previos. No presenta esta lane como PostgreSQL ni servidor desplegado.

Frontend/proxy: 345 casos en dieciséis archivos, una corrida final aprobada:

- clinical-record-recovery.test.tsx: 64. Reintento tras desmontaje con la misma
  clave y comando exacto, sin escrituras automáticas; autorización fresca,
  expiración, aislamiento por paciente/tipo/documento, permisos revocados,
  respuestas tardías, borrado seguro por generación y regresiones UX-018.
  Correcciones inciertas y POST pendientes bloqueados. Peso confirmado con
  lectura fallida al salir recupera ID y solo reintenta GET.
- treatment/study/weight-form: 50. Revisión/confirmación, precisión y fechas,
  recuperación de errores y clave UUID en nuevas creaciones. Peso tras fallo de
  lectura reintenta GET, con un único POST. DTOs legados sin unidad.
- treatment/study/weight-list: 59; clinical-workspace: 47;
  staff-session-boundary: 7; patient-detail: 10. Regresión de navegación/listas,
  consultas, sesión y ficha; no se modifican sus invariantes.
- creation-idempotency proxy: 6. Clave JSON por bytes, cookie staff,
  private/no-store, conflicto 409 conservado, rechazo de clave en PUT/search,
  sin headers de autoridad ni propagación de AbortSignal en comandos.
- treatment/study/weight-write proxy: 66; route: 19; weight-read: 17.

Database: schema-clinical.test.ts, 15 invariantes estáticas previas aprobadas.
Las nuevas restricciones de recibos se verifican en PostgreSQL real abajo. Estas
suites usan fetch/reloj y navegación simulados; no certifican apariencia, lector
de pantalla, Back/Forward o sesión real de navegador.

Comandos: binarios Vitest instalados desde apps/api, apps/web y
packages/database, con NODE_OPTIONS=--experimental-strip-types y archivos
explícitos. Detalle de la corrida web: 16 archivos, 345/345, 65,10 s. Tipos y
lint se ejecutan separadamente de estas simulaciones.

## PostgreSQL real desechable — 37 pruebas aprobadas

El servidor configurado 127.0.0.1:5433 no estaba disponible. No se levantó ni se
migró la base de desarrollo. Se creó exclusivamente un contenedor aislado:
newsaas-ux019-disposable-pg, postgres:16-alpine, puerto local 55439,
almacenamiento tmpfs sin volúmenes del proyecto, usuario/contraseña sintéticos
de prueba.

DATABASE_URL se reemplazó solo para los procesos de pruebas por la conexión al
contenedor temporal. Cada runner creó una base de nombre aleatorio validado,
aplicó todas las migraciones y eliminó solo esa base en finally. Sin .env
modificado, seeds operativos ni lectura de registros de desarrollo/producción.

- node scripts/verify-clinical-creation.mjs: 25 casos. Prisma,
  ClinicalRecordsService y AuditWriter reales. Para cada tipo: replay exacto de
  respuesta confirmada descartada (simula respuesta perdida), seis solicitudes
  simultáneas iguales con un único ID/recibo/auditoría, carrera con contenidos
  distintos y un ganador/CONFLICT, scopes de paciente y tenant independientes,
  paciente ajeno 404, permiso/entitlement revocados antes de replay, fallo de
  auditoría con rollback de registros/recibos y reintento de misma clave,
  comportamiento legado sin clave y rechazo de clave inválida. También: tipos
  independientes, snapshot original tras correcciones, canonicalización de
  fechas/contexto, distinción KG/desconocido, FK compuesta, trigger inmutable y
  fallo inyectado de INSERT de recibo que revierte registro y auditoría después
  de ambos writes. No se simula la base de datos.
- node scripts/verify-weight-entry.mjs: 12 casos de regresión real de
  Decimal(10,3), KG/unknown, DTOs legados, permisos, filtros y
  auditoría/rollback.

Migración nueva: 20261030000002_clinical_creation_receipt. Solo DDL aditivo, sin
backfill/conversión/retención automática, probado sobre bases vacías
reproducibles; ninguna migración aplicada sobre base configurada u operativa. La
pérdida de respuesta se modela descartando el resultado ya confirmado; no se
afirma un corte de socket HTTP real. HTTP/auth guard chain se cubre en la lane
simulada; permisos/entitlement y aislamiento se cubren también con PG.

## Calidad y builds

Lint API y web completos aprobados con ESLint instalado. Tipos API/web/database
con TypeScript --noEmit y build-info separado. Prisma validate/generate sobre
copia de esquema temporal, sin sobrescribir el cliente usado por desarrollo.
Builds API/database con outDir y tsBuildInfoFile temporales. Build web aislado
con fuentes/configuración copiadas y node_modules enlazado; sin tocar .next/dist
del checkout ni reiniciar procesos dev. Build web final y
scripts/verify-build-output.mjs aprobados con salida 0. No se omiten checks para
declarar éxito.

Directorio aislado:
C:/Users/esteb/AppData/Local/Temp/newsaas-ux019-build-elwmJ9. El cliente Prisma
nuevo se generó solo allí; src/generated/dist activos intactos. Build Next final
aprobado después de invalidar la caché ESLint de esa copia; avisos informativos
previos de Next sobre referencias TS/plugin ESLint continúan. 521 pruebas
distintas totales; no se suman repeticiones.

## Incidencias y correcciones

Vitest/esbuild no pudo resolver configuración dentro del sandbox: se usaron los
mismos binarios instalados con acceso ampliado. Un comando con --root y --config
relativo duplicó apps/web; corregido al ejecutar desde apps/web. Algunos
comandos de preparación se ejecutaron inicialmente desde cwd de un paquete y
fallaron por ruta inexistente antes de escribir; corregidos desde raíz.

Las expectativas antiguas bloqueaban POST incierto por contrato UX-018; se
actualizaron a reintento idempotente y se añadieron regresiones de PUT incierto,
pendientes, claves/command preservados y GET-only de peso confirmado. Tres
expectativas del body se extendieron para la nueva clave sin relajar campos.
Lint detectó aserciones innecesarias y matcher any en pruebas; se corrigieron
con tipos explícitos/unknown, sin desactivar reglas.

El primer build temporal omitió setup de tipos de pruebas y falló en matchers ya
existentes. Se completó la copia con vitest.setup/config. La caché ESLint del
build conservó esos diagnósticos; se retiró únicamente esa caché temporal tras
verificar su ruta. Tipos y lint directo en esa copia aprobaron. No se alteraron
reglas ni fuentes ajenas para superar errores de preparación. Prisma format
introdujo espaciado en otros modelos: se retiró solo ese ruido, conservando las
dos adiciones de esquema de UX-019.

## Límites

Sin visual/Playwright/E2E, lector real, navegación/sesión desplegada o datos
operativos. No despliegue. TD-066 sigue abierta para concurrencia PUT/CAS/ETag,
historial, recuperación durable y validación visual/E2E. Sin cambios de
consultas cerradas, vacunas, desparasitación, Portal, pagos, caja, inventario,
ventas o vínculos clínicos. Recarga/descarte/expiración pierde la clave local;
no hay promesa de recuperar ese intento después ni deduplicación de otros
intentos.
