---
type: qa
status: passed
story: UX-023
date: 2026-10-30
updated: 2026-10-30
---

# UX-023 — Historial de correcciones clínicas

## Alcance y autorización

Usuario eligió explícitamente las tres primeras opciones (1/1/1): motivo
obligatorio en formulario nuevo, permiso de lectura específico inicialmente para
propietario/admin/veterinario y consulta por registro. DEC-086 accepted; PRD
§§13.2/27 actualizado explícitamente, sin modificar DEC-085 proposed. Clave
técnica vet.clinical.history_read ajustada a domain.resource.action del repo,
manteniendo los lectores aprobados.

Contexto: AGENTS, ingeniería/documentación, comandos Story/Decision, PRD
§§12.1/13/27/41, Clinical, TD-066, ADR-001 y DEC-084/086. UX-023/DEC-086 libres
verificados; Story pasó de planned a in-progress antes de código. Branch main,
cambios acumulados conservados. No commit/push, dependencias nuevas o datos
operativos. Solo tres tipos especializados, sin consultas cerradas, vacunas,
desparasitación, Portal, vínculos, finanzas o inventario.

## Implementación verificada

Migración 20261030000004_clinical_correction_history: tres tablas tipadas
clinical_{treatment,study,weight}_revision con FK tenant/paciente/registro,
unicidad por versión posterior, snapshots exactos antes/después, actor/nombre
histórico, motivo e instante. Timestamps(3), Decimal(10,3), KG/null. Triggers
AFTER UPDATE capturan OLD/NEW después del incremento técnico de versión; DB
rechaza UPDATE/DELETE de revisiones. Nombres/defaults de constraints alineados
con Prisma y validados nuevamente en contenedor nuevo. No backfill o purga.

Servicio fija actor/ID/motivo mediante set_config transaccional local antes de
UPDATE. AuditLog contiene revisionId y campos/IDs, nunca snapshots o motivo.
Antes de auditar, confirma por ID/scope/versión que la revisión fue capturada:
si falta la migración o se deshabilitó el trigger, falla y revierte la
corrección. Registro/revisión/auditoría co-commit; un error revierte todos.
Contexto local no se hereda al siguiente comando. Direct SQL sin contexto queda
sin actor/ motivo informado; no se inventa auditoría de aplicación o identidad.

PUT acepta correctionReason opcional, validado no vacío/solo espacios y
máximo 2000. UI lo exige al corregir, lo muestra en revisión y conserva en copia
temporal UX-018. Razón sola sin cambio de campos es no-op. Campos clínicos
presentes con valores iguales mantienen UPDATE/version/auditoría/historial.
Legados siguen funcionando y muestran Sin motivo informado; no se afirma
obligatoriedad universal, idempotencia de PUT o posibilidad de reintento
incierto. Creación idempotente y peso confirmado con relectura GET-only
intactos.

API aditiva: GET /patients/:patientId/clinical/history-access devuelve solo
allowed, exige clínica read/tenant/veterinary; POST
.../{treatments|studies|weights}/:id/history/search exige además
vet.clinical.history_read. BFF limita rutas/cookie/body, devuelve
private/no-store y propaga aborto solo de lectura. Cursor beforeVersion en body,
20 elementos máximo, orden por versión descendente estable ante inserciones. DTO
allowlisted, UUID ajeno 404 y sin Portal. No permiso basado en nombre de rol.

## Simulación — 535 casos distintos

359 web/proxy: formularios 53 (tratamiento 16, estudio 19, peso 18),
recuperación 67, concurrencia UI 9, contratos de transporte 52,
historial/capacidad 19 y proxy 159. Comando con Vitest instalado desde apps/web,
NODE_OPTIONS=--experimental-strip-types, vitest.config.ts y selección explícita
de los tres *-form.test.tsx, clinical-record-recovery,
clinical-correction-concurrency, clinical-write-contract,
clinical-history.test.tsx y directorio src/app/api/clinical/[[...path]].

La corrida amplia inicial tuvo 351 passed/3 failed: el test de paginación leía
el DOM durante loading. Se corrigió esperando la respuesta renderizada;
historial 15/15 revalidado, sin sumar reejecución. Después de corregir
integración de acceso se revalidaron 149 casos dirigidos (tres
formularios/recuperación/ historial/capacidad/proxy history), todos verdes;
incluye cuatro casos nuevos de capacidad y uno de BFF. No se suman como casos
nuevos los ya existentes. Logs Temp/ux023-web-final-tests.log,
ux023-history-recheck.log y ux023-access-tests.log. Siete llamadas negativas de
tsc no se ejecutan ni cuentan como tests adicionales.

131 backend simulados: clinical.http.integration (19), clinical.records.service
(13), clinical.service (26), treatment-search.integration (20),
study-search.integration (20), weight-search.integration (33). Comando final
explícito de esos seis archivos con Vitest instalado/config, 6/6 archivos y
131/131, salida 0; Temp/ux023-api-capture-final.log. Nest/guards reales con
base-fixture simulada; capacidad positive/negative, ambos permisos,
autenticación, aislamiento y regresión clínica. No se presentan como PG.

Una selección por directorio incluyó clinical.links.integration.test.ts, que
requiere CLINICAL_LINKS_TEST_URL propio y falla al construir Prisma con URL
undefined incluso estando skipIf. Falló antes de conectar/ejecutar casos. No se
cambió ese archivo ni se ejecutó su suite PG; se corrigió la selección a los
seis archivos aplicables. No se declara que el comando amplio fue verde.

45 database estáticos/simulados: reference-seed.test.ts (30) y
schema-clinical.test.ts (15), 45/45 en 1,27 s. Catálogo sube a 67 permisos,
clave dentro de convención y grant exclusivo inicial a los tres roles. Primer
intento detectó clave de cuatro segmentos/expectativas de catálogo antiguas; se
corrigieron clave y expectativas, sin ampliar el formato de permisos.

## PostgreSQL real desechable — 72 casos

Solo postgres:16-alpine nuevo con tmpfs, credenciales sintéticas y puerto
loopback aleatorio. DATABASE_URL apunta exclusivamente a su catálogo postgres
para crear/eliminar DB guardadas por regex; nunca a la base configurada/dev.
Scripts existentes desde raíz con binarios instalados:

    node scripts/verify-clinical-creation.mjs
    node scripts/verify-clinical-correction.mjs

25 creación: replay después de descartar respuesta del commit, carreras,
contenido distinto, aislamiento tenant/paciente/tipo, permisos/entitlement,
auditoría/recibo únicos, rollback, FK/inmutabilidad y compatibilidad sin clave.

47 corrección/historial (26 previos + 21 nuevos): snapshots exactos, nombre
histórico conservado tras renombrar perfil, motivo/omisión legada, ID vinculado
a auditoría; ambos permisos/veterinary y 404 entre tenants/pacientes; revisión
inmutable; conflicto sin revisión; fallo de auditoría o inserción de historial
revierte todo; trigger deshabilitado revierte fila/versión/auditoría en los tres
tipos, y al reactivarlo vuelve a capturar; SQL sin contexto no hereda
actor/motivo; cursor de 20 filas sin duplicados al corregir entre páginas.
Autorización de servicio usa sets de permisos controlados en fixture;
autenticación/membresía/permiso desde DB real se ejercita por la lane de
navegador siguiente.

Primer intento tuvo 41/44: DDL del trigger de fallo sintético quedó con un solo
$ por sustitución del generador del test. Corregido a delimitador $$; la
migración de implementación se aplicó correctamente en PG desechable: fallaba
solo el DDL del test. Corridas siguientes aprobaron 25/25 y 44/44. La última
incluyó tres casos nuevos de captura deshabilitada: 25/25 y 47/47, sin sumar
rondas. Artefactos newsaas-ux023-QlHCq8 en Temp,
pg-creation.log/pg-correction.log, salida 0 y contenedor eliminado. No seed demo
o proveedor externo.

## Navegador real — 17 casos

    node scripts/verify-clinical-browser.mjs

Lane clínica aislada: compila catálogo actual de referencia, API y Next fuera de
dist/.next activos; Prisma/Redis tmpfs propios, fixture mínima, Chrome local
headless, cookie staff/BFF/API/PG reales. No .env copiado, servicios dev
reutilizados o providers externos; no worker/demo financiero. Catálogo se
compila para no depender de dist instalado anterior ni reemplazarlo.

Primera ejecución JuNOqL: 0 passed, 1 failed y 16 no ejecutados, salida 1. La
ficha real no suministraba props de permisos y la entrada de historial se ocultó
al usuario autorizado. Se corrigió con capacidad backend específica y tests, sin
relajar permisos o inventar rol. Una caída de capacidad ofrece relectura, una
denegación oculta entrada y cada búsqueda revalida permiso en backend.

Segunda ejecución desde cero QDiQ3n: 17/17, salida 0, 1,1 min, retries=0,
maxFailures=1. Incluye tres tipos de registro/corrección con motivo, apertura de
historial/antes/después, snapshots desktop/móvil; replay tras respuesta perdida
y Atrás/Adelante; CAS, descarte/recuperación, sesión y permisos, peso confirmado
GET-only y fecha sola de peso con unidad desconocida. Caso nuevo: lector clínico
sin history_read no ve entrada y recibe 403 del BFF/API real.
Login→Inicio→Pacientes→ficha mediante enlaces, documento conservado.

Se inspeccionaron seis capturas nuevas: {treatment,study,weight}-history-
{desktop,mobile}.png bajo Temp/newsaas-ux021-browser-QDiQ3n/screenshots. Se
comprobaron actor/motivo literal, antes/después, multilinea, fechas es-PY/
Paraguay con segundos/milisegundos, cantidades/unidades y legibilidad a 1440 y
390 px; sin overflow de contenido en móvil. Nuevos controles son nativos y
semánticos; foco al abrir/paginar/cerrar probado en componentes. No certifica
WCAG, lector, Safari/Firefox o equipo físico. No se usa UX-021 como sustituto de
esta ejecución actual.

Esta ronda de navegador precedió a la comprobación final backend de captura; ese
cambio no modifica UI/contrato y se revalidó con 72 casos PG y 131 simulados,
tipos/build y lint API. No se hizo otra ronda de navegador para ese guard.

## Checks, clasificación y límites

Lint API/web/e2e y database aprobados; database conserva 12 warnings de console
en scripts anteriores no modificados (cero errores, salida 0). Tipos API/web/
e2e y compilación database/reference aislada aprobados; API/web builds propios y
verificador Next aprobados. Prisma validate/generate en copia temporal con
cliente propio (newsaas-ux023-schema-Wtjalp), sin reemplazar generated/dist de
dev. node --check del runner, formato y diff revisados. Se conservaron fallos
intermedios y resultados finales por separado; no se suman como pruebas nuevas.

Capturas por asociación clínica CONFIDENTIAL, trazas fallidas con cookies
sintéticas RESTRICTED, solo Temp; sin storageState guardado o artefactos en Git.
Escaneo acotado del log final para cinco marcadores clínicos sintéticos: cero
coincidencias. No equivale a auditoría integral de logging. Datos clínicos,
motivo, identidad histórica/IDs/versiones CONFIDENTIAL; capacidad mínima es
privada y patient-scoped. Sin logs/URLs/Storage de contenido o política de
retención destructiva nueva. Historial no reconstruye cambios anteriores ni
atribuye actor/auditoría de aplicación a SQL sin contexto.

Total 624 casos distintos (535 simulados/estáticos, 72 PG, 17 E2E), sin contar
repeticiones o llamadas negativas de tipos. Sin migración sobre base operativa,
commit/push, servicios/dependencias nuevos o corte público DEC-085. TD-066 sigue
abierta para corte global de clientes legados y recuperación durable.
