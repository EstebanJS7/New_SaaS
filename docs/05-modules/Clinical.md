---
type: module
module: clinical
status: implemented
updated: 2026-10-31
---

# Module — Clinical

## Responsibility

Tenant-scoped veterinary clinical records for a Patient: a versioned
`ClinicalEncounter` with linked amended corrections, and five typed subdomain
records (treatments, vaccinations, deworming, studies, weights).

## Does Not Own

- Scheduling/appointment lifecycle, Portal delivery, files, reports, billing or
  fiscal behavior.
- Patient identity or guardian links (owned by EPIC-05 Patients).
- A generic event bus; `ClinicalEncounterClosed` is intentionally not emitted.

## Public Capabilities

- Create/list/get encounters anchored to a Patient.
- Version-guarded DRAFT autosave; explicit close; linked, audited, idempotent
  amendments.
- Create/list/update for the five subdomain record kinds (no delete).
- A staff HTTP surface behind granular permissions and the `veterinary`
  entitlement, plus an authenticated web proxy and staff workspace.
- A staff ENTRY surface for vaccinations and deworming, including the
  staff-entered `nextDueAt` a report reads ([[REP-010]]).

## Main Entities

- `ClinicalEncounter` — content + `internalNotes`/`clientSummary`, `status`,
  `version`, `amendsEncounterId`/`amendmentReason`, `idempotencyKey`.
- `ClinicalTreatment`, `ClinicalVaccination`, `ClinicalDeworming`,
  `ClinicalStudy`, `ClinicalWeight` — typed minimum facts, Patient-anchored.

## State Transitions

```text
ClinicalEncounter: DRAFT --autosave(version N -> N+1)--> DRAFT
                   DRAFT --close(version N)--> CLOSED
                   CLOSED --amend(reason[, idempotencyKey])--> new linked CLOSED row
```

A CLOSED encounter is immutable; the original is never mutated.

## Permissions

- `vet.clinical.read|create|update|close|amend`, each pinned per route by the
  route-contract probe.
- The service re-applies the `veterinary` entitlement
  (`403 FEATURE_NOT_ENTITLED`) and the granular permission (`403 FORBIDDEN`) as
  defense in depth.

## Staff surface (web)

The Spanish staff workspace ([[UX-002]]) reviews closure in a modal. Pending
draft content is saved first; the close command consumes the saved response's
version immediately, without depending on a React render. A failed/conflicted
save or a newer local edit prevents closing and preserves the draft. Cancelling
the confirmation does not issue a close command.

One page, `apps/web/src/app/(app)/app/patients/[id]/`, rendered inside the staff
`(app)` shell through the authenticated `/api/clinical` proxy:

- **Clinical records** — the encounter card: create, version-guarded autosave,
  close, amend.
- **Vaccinations and deworming** — the specialized-record card
  (`clinical-records.tsx`): list, create, correct, and **clear the due date**.

Both cards are per-patient and independent. The second one is the only staff
path that fills `next_due_at`, the nullable column [[DEC-065]] added for PRD
§31's "upcoming/overdue vaccines" and "upcoming deworming" reports; [[DEC-067]]
scoped that entry path to these two record kinds and to nothing else.

What the surface guarantees, all of it UX-only — the API re-asserts every gate:

- An empty due date renders the explicit "No due date recorded" state, never a
  blank or a placeholder date. `null` means "not monitored", and the reports
  omit the row instead of deriving one.
- A wrong due date is REMOVABLE, not only replaceable: the correction form sends
  an explicit `nextDueAt: null`, which is the contract `PUT …/:id` already
  accepted. A create with no due date OMITS the key, because the create schema
  treats an absent key as "no due date" and rejects `null` there.
- Entry and display use `<input type="datetime-local">`, and the typed
  wall-clock value is converted to an ISO instant in the browser before it
  leaves, so the reports bucket the row to the local day staff chose.
- The create and correct affordances are hidden when the shell supplies
  permissions without `vet.clinical.create` / `vet.clinical.update`; when the
  shell supplies none (`undefined` = unknown), they stay visible and the API's
  `403 FORBIDDEN` remains the authority.
- Loading, empty, error, success and permission-denied states exist for both
  lists, styled with semantic branding tokens only.

**Staff entry.** Treatments ([[UX-015]]), studies ([[UX-016]]) and weights
([[UX-017]]) have entry/correction beside their paginated read surfaces.
[[TD-055]] is resolved for this functional gap; [[TD-066]] tracks command and
draft navigation limitations. Visual/E2E certification is not claimed. There is
also no cross-patient "all vaccinations" view: the due reports are that view,
aggregated.

## Clinical form and closure refinement — UX-002

The working copy preserves spaces while typing. Each optional text field mirrors
the API's 10,000-character bound with a linked error/count; invalid content
cannot autosave or close. Manual draft save retries failures explicitly instead
of repeatedly retrying an unchanged failed write. The mounted guard is
re-enabled correctly after React StrictMode effect cleanup/setup.

Pending edits disable switching/creating encounters. Same-document section links
remain available. Other clicked links require an accessible exit confirmation;
autosave pauses while deciding, and in-flight writes must finish before exiting.
Reload/window close uses native beforeunload. Back/Forward and programmatic
same-document route changes retain pending content in QueryClient memory for ten
minutes while away. A fresh authorized read gates restoration; explicit manual
save confirms the recovered content. Version drift blocks overwrites; a remotely
closed record stays immutable. See [[TD-065]]. No draft content is written to
browser storage; recovery does not survive a new document or logout.

Closure reviews the current staff content, separates client summary from
internal notes and keeps the existing save/version/close sequence. Blank fields
remain optional. Closed consultations render persisted content read-only beside
the existing explicit amendment command. Closing does not complete an
appointment or create a sale. No appointment/professional linkage was added to
the clinical DTO.

## API

- `GET|POST /patients/:patientId/clinical/encounters`
- `GET|PUT /patients/:patientId/clinical/encounters/:id`
- `POST /patients/:patientId/clinical/encounters/:id/close`
- `POST /patients/:patientId/clinical/encounters/:id/amendments`
- `GET|POST /patients/:patientId/clinical/{treatments|vaccinations|deworming|studies|weights}`
- `PUT /patients/:patientId/clinical/{kind}/:id`
- `GET /api/clinical/[...path]` — authenticated staff web proxy (allowlisted
  route shapes, UUID-only Patient anchor, re-encoded segments).

## Events / Jobs

- None. No internal event or background job is emitted; corrections are explicit
  application commands.

## Invariants

- One atomic conditional `updateMany(status=DRAFT, version=N)` makes autosave
  concurrency-safe: a stale/concurrent write changes nothing and returns
  `409 CONFLICT`.
- Amendments take `SELECT … FOR UPDATE` on the original inside the transaction,
  so concurrent corrections serialize; a repeated idempotency key resolves to
  the existing amendment.
- Exactly one audit row is appended per mutation, co-committed in the same
  transaction.
- Database-enforced: CLOSED rows are immutable and not hard-deletable; subdomain
  rows are not hard-deletable; a weight quantity is strictly positive.

## Security / Tenant Rules

- Tenant identity comes only from `RequestContextService`; a route/body
  `tenantId` is never trusted.
- A foreign Patient UUID or foreign clinical aggregate UUID returns a
  byte-equivalent `404 NOT_FOUND` and persists nothing.
- DTOs are allowlisted and CONFIDENTIAL; Prisma models are never returned.
  `internalNotes` is excluded from client-safe projections and never logged.

## Verification

- `apps/api/test/live-pg-isolation.e2e-spec.ts` — "EPIC-06 clinical
  application-path isolation" (8 tests) against a disposable PostgreSQL 16
  database: allowlisted DTO + autosave, live encounter CLOSED immutability and
  encounter no-delete trigger enforcement (the five subdomain no-delete triggers
  are pinned statically by the WU1 schema migration test, not live-executed),
  linked audited amendment, byte-equivalent cross-tenant `404`, negative
  cross-tenant amendment before/after assertions, and a deterministic-barrier
  parallel-autosave race yielding one success + one `409 CONFLICT`.

## Related Stories

- [[VET-004 Clinical Encounter]]
- [[REP-010]] — the vaccination/deworming entry surface and the due date it
  fills

## Related Decisions

- [[DEC-065]] — `next_due_at` on both tables, entered by staff, NULL = not
  monitored
- [[DEC-067]] — this entry path is scoped to vaccinations and deworming

## Technical Debt

- [[TD-055]] — specialized staff entry gap resolved through UX-017
- [[TD-066]] — treatment/study/weight concurrency, uncertain results and draft
  navigation limits

## Related ADRs

- [[ADR-001 Modular Monolith]]

## Appointment navigation context — UX-005

Staff navigation can carry an appointment ID from agenda to patient detail and
then POS. A Veterinary frontend composition reads the existing authorized
appointment and presents date/status/professional/service; patient-detail
context must match the current patient. Invalid/unreadable context has explicit
feedback without blocking the independent workspace. The closed consultation
offers a POS link; no sale, payment or appointment transition is issued by
navigation.

This is not a persisted appointment/encounter/sale association. No clinical data
or price is placed in URLs, no new API or financial orchestration was added, and
no Core backend module imports Veterinary implementation. See [[UX-005]] and the
still-proposed [[DEC-083-appointment-clinical-sale-journey]] for the boundary.

## Explicit care links — UX-006 / DEC-083

Veterinary now owns immutable, typed ClinicalAppointmentLink and
ClinicalSaleLink records. One appointment can have multiple encounters, one
encounter at most one appointment origin. One encounter can have multiple sales;
a sale belongs to at most one encounter. Standalone encounters/sales remain
allowed. A link can be added to a closed encounter without editing its clinical
content.

GET `/patients/:patientId/clinical/appointments/:id/encounters` lists linked
IDs. GET `/patients/:patientId/clinical/encounters/:id/links` returns
allowlisted IDs, sale status and related-domain read availability. POST
`.../links/appointment` and `.../links/sale` validate strict UUID bodies;
identical requests replay without duplicate audit, incompatible origins
return 409. Missing/foreign/mismatched patient resources return 404. Every
mutation requires clinical read/update and the target domain's read permission;
Veterinary entitlement is always required, and sale links also respect the sales
entitlement. Tenant context is server-owned.

Link creation and audit share a transaction; encounter/sale row locks serialize
competing origin links. Composite tenant/patient FKs, unique origin constraints
and immutable-link triggers back the application checks. No delete/relink
endpoint. The staff UI explicitly confirms linking and can reopen linked
consultations and existing draft sales. POS can link the newly created sale
without recreating it. The scheduled service is suggested only through current
active catalog data and operator acceptance. Customer selection, closing an
encounter, appointment completion and payment completion remain separate
commands. No price or clinical content is copied into the association or URL.

Migration: `20261028000001_clinical_journey_links`. CONFIDENTIAL staff-only IDs;
no new Portal projection, logs of content or destructive retention.

## Consulta paginada de tratamientos — UX-012

La ficha del paciente incorpora una sección Tratamientos y su ancla de
navegación. No crea ni corrige registros. Buscar/Enter aplica una descripción
vacía o de 2–80 caracteres; solo busca `description`, sin contexto, datos de
responsables, dosis, estados ni asociaciones clínicas inventadas.

POST `/patients/:patientId/clinical/treatments/search` acepta exclusivamente
`q`, `page` (1–10000), `period` (`all` por defecto o `last30`) y `sort`
(`recent` por defecto u `oldest`). `last30` significa los treinta períodos de 24
horas previos al instante de consulta en servidor, extremos incluidos,
excluyendo administración futura. El orden usa `administeredAt` y UUID
ascendente de desempate. Paciente, conteo y página comparten una transacción
RepeatableRead; 20 filas máximo, página fuera de rango ajustada a la última o 1
sin resultados. Incluye pacientes inactivos para consultar su historial.

Lista: `id`, `description`, `administeredAt`. El detalle se obtiene al abrirlo
mediante GET `/patients/:patientId/clinical/treatments/:id` y agrega solo el
`context` existente, nullable. No devuelve modelos Prisma, tenant, auditoría ni
otros dominios. Cada lectura reafirma veterinary y vet.clinical.read. Tenant
desde contexto; paciente extranjero, tratamiento extranjero, de otro paciente o
inexistente reciben el mismo 404. Staff/membresía se exigen en la cadena HTTP.

El proxy clínico existente permite únicamente esas dos nuevas lecturas, toma
solo la cookie staff y request-id, rechaza query strings y claves adicionales,
conserva bytes del body, señal de aborto, estado y envelope. Las respuestas son
private,no-store; el API también marca así las lecturas exitosas nuevas. Los GET
de listas y POST/PUT anteriores conservan contrato y consumidores.

Detalle y retorno están dentro de la misma sección, sin contenido ni selección
en URL. Búsqueda aplicada, período, orden y página se conservan por paciente en
QueryClient durante diez minutos en memoria del documento. No hay Storage ni
persistencia/deshidratación; recarga/reingreso descartan el contexto. La UI
reconsulta al volver, protege contra resultados obsoletos, ofrece español,
es-PY/horario Paraguay, estados de carga/vacío/error/reintento y foco en el
encabezado al abrir/cerrar detalle. Componentes con tokens semánticos.

Todo el contenido clínico es CONFIDENTIAL. Sin logs de texto, nuevas columnas,
migraciones, dependencias, Portal, mutaciones operativas ni cambios de
consultas, prevención, stock o finanzas. Evidencia y límites en
[[UX-012-VALIDATION-2026-10-30]]. Sin revisión visual/E2E de navegador en esta
etapa.

## Consulta paginada de estudios — UX-013

La ficha agrega una sección Estudios con ancla de navegación. Buscar/Enter
consulta solamente studyType: vacío o 2–80 caracteres. No consulta result ni
crea taxonomía, estados, adjuntos, diagnóstico o asociaciones clínicas. No
ofrece creación/corrección.

POST `/patients/:patientId/clinical/studies/search` acepta q, page (1–10000),
period (all por defecto o last30) y sort (recent por defecto u oldest), sin
claves adicionales. Páginas de veinte, orden performedAt y UUID ascendente;
paciente, conteo y filas en RepeatableRead. Incluye pacientes inactivos. last30
abarca treinta períodos de 24 horas hasta el instante del servidor, extremos
incluidos, sin futuro. Ajusta páginas a la última o 1 cuando vacío.

La lista proyecta id, studyType y performedAt. GET
`/patients/:patientId/clinical/studies/:id` reautoriza al abrir y agrega solo
result. Texto vacío: “Sin resultado registrado”, sin inferir pendiente, negativo
u otro estado. Conserva multilínea como texto literal, sin interpretar HTML. No
modelos Prisma, metadata interna, medicamentos, archivos ni responsables.

Staff/membresía en HTTP; veterinary y vet.clinical.read reafirmados en servicio;
tenant del contexto. Estudio/paciente ajeno, inexistente o de otro paciente
devuelve el mismo 404. Proxy clínico existente: solo nuevas formas POST search y
GET UUID; cookie staff/request-id, bytes de JSON, aborto, rechazo de queries y
claves extra, private,no-store, estado/envelope preservados. Contratos
anteriores GET/POST/PUT conservados, incluidos tratamientos.

Detalle/retorno dentro de sección, foco al abrir/cerrar, español/es-PY y fecha
Paraguay, tokens semánticos y carga/vacío/error/reintento. Filtros aplicados,
búsqueda y página por paciente en memoria del documento por diez minutos; sin
URL, logs, Storage o deshidratación/persistencia. Reconsulta al regresar;
recarga/reingreso descartan contexto. AbortSignal y claves por búsqueda/paciente
evitan resultados obsoletos.

Contenido clínico CONFIDENTIAL. Sin columnas, migraciones, dependencias, Portal,
escrituras operativas ni cambios de tratamientos, consultas, prevención o
finanzas. TD-055 sigue abierto para entrada/corrección de tratamientos/estudios
y superficie de pesos. Ver [[UX-013-VALIDATION-2026-10-30]]; simulación,
PostgreSQL real y revisión visual/E2E no ejecutada se documentan por separado.

## Consulta paginada de pesos — UX-014

La ficha agrega Pesos, con navegación a la sección y detalle de lectura fresco.
No hay campo textual buscable: filtra por minQuantity/maxQuantity opcionales y
por fecha de medición, sin inventar descripción, diagnóstico o unidad.

POST `/patients/:patientId/clinical/weights/search` acepta exclusivamente page
(1–10000), period (all/last30), sort (recent/oldest) y límites como strings
decimales positivos de hasta siete enteros/tres decimales, mínimo <= máximo.
Límites inclusivos comparados con Prisma.Decimal, jamás floats. El valor de cada
filtro viaja solo en body; no existe q. Páginas de veinte, measuredAt y UUID
ascendente de desempate, paciente/conteo/filas en RepeatableRead; páginas
ajustadas a última o 1 sin filas. Pacientes inactivos conservan lectura de
historial. last30 son treinta períodos de 24 horas hasta el instante del
servidor, extremos incluidos y futuro excluido; rango y período pueden
combinarse.

Lista y GET `/patients/:patientId/clinical/weights/:id` proyectan solamente id,
quantity y measuredAt. Quantity es string exacta de escala tres, serializada con
toFixed(3) sobre el NUMERIC(10,3) almacenado; no calcula ni redondea otro valor.
El formato es-PY usa el helper decimal exacto existente. El modelo y contrato
carecen de unidad: la UI indica “Unidad no especificada en el registro”. No
sufijo kg, conversiones, gráfico o interpretación clínica.
[[DEC-084-weight-measurement-unit]] propone definir contrato e históricos antes
de crear/corregir pesos; sigue propuesta y no modifica el PRD.

Staff/membresía en HTTP; veterinary y vet.clinical.read reafirmados por lectura.
Tenant del contexto; paciente/peso ajeno, inexistente o de otro paciente recibe
el mismo 404. Proxy clínico con nuevas formas allowlisted, cookie solo staff,
request-id/AbortSignal, body exacto, rechazo de queries/claves extra y
respuestas private,no-store. GET/POST/PUT anteriores y consumidores se
conservan.

Filtros locales usan coma decimal y agrupación opcional; normalización por
strings y comparación mediante BigInt en milésimas, sin Number. Límites vacíos
se omiten; inválidos/invertidos tienen error explícito antes de consultar.
Aplicar/Enter, limpiar, período y orden, carga/vacío/error/reintento, controles
etiquetados y foco al abrir/volver. Contexto aplicado por paciente en memoria
del documento diez minutos, sin Storage/persistencia/deshidratación;
recarga/reingreso lo descartan. Claves separadas y aborto impiden respuestas
obsoletas.

Datos y filtros clínicos CONFIDENTIAL; sin logs de contenido, columnas,
migraciones, dependencias, Portal, escrituras operativas ni alteración de
consultas, prevención, tratamientos/estudios o finanzas. TD-055 sigue abierto
para entrada/corrección de los tres tipos. Evidencia en
[[UX-014-VALIDATION-2026-10-30]]; sin nueva revisión visual/E2E de navegador.

## Registrar y corregir tratamientos — UX-015

La sección Tratamientos agrega Registrar tratamiento y, desde detalle fresco,
Corregir tratamiento. Descripción requerida de hasta 2000 caracteres, fecha y
hora de administración en reloj Paraguay y contexto opcional hasta 10000.
Revisión modal y confirmación explícita antes de escribir; sin autosave. La
fecha usa los conversores de agenda existentes, independientes de la zona del
navegador. Editar fecha guarda precisión de minuto; corregir descripción o
contexto omite la fecha y preserva segundos/milisegundos originales.

Reutiliza POST `/patients/:patientId/clinical/treatments` y PUT
`/patients/:patientId/clinical/treatments/:id`, sin cambio de DTO/comandos. PUT
contiene solo campos modificados; vaciar contexto envía null. Una relectura
previa comprueba los campos que se van a corregir y bloquea cambios remotos
visibles; no es control de versión transaccional. El servicio existente valida
create/update por separado, veterinary y tenant; mutación y auditoría de actor/
campos se confirman en la misma transacción. No se modifica consulta cerrada ni
se crea un amendment clínico.

El proxy trata estas escrituras como privadas: cookie solo staff, request-id,
body JSON exacto, rechazo de query strings y claves ajenas; private,no-store. No
propaga AbortSignal de comandos para simular que abortar asegura rollback.
Cliente sin reintentos automáticos; guardia de envío y controles pendientes
evitan doble clic. Red, 408, 5xx o respuesta de éxito ilegible implican
resultado incierto: bloquear reenvío y revisar listado/detalle, no repetir
automáticamente.

Éxito muestra confirmación, invalida listado/detalle y abre el registro guardado
sin alterar búsqueda/filtros/página. Permisos conocidos ocultan create/update
independientemente; desconocidos siguen el patrón actual de las tarjetas
clínicas, con rechazo explícito de API. El shell aún no suministra claims a esta
sección: esto no certifica ocultación por rol en producción. Backend es
autoridad.

Cancelar con cambios requiere confirmación, errores preservan formulario montado
y la revisión conserva el texto. Clic en enlaces de salida y beforeunload
advierten cambios, bloqueando salida por clic mientras se guarda. No se escribe
contenido en URL, logs o Storage; Back/Forward, navegación programática, recarga
y reingreso no recuperan este borrador. [[TD-066]] registra esas fronteras y la
ventana GET→PUT sin versión, idempotencia POST ni historial de valores previos.
No se presenta como resuelto por una relectura frontend.

Campos existentes CONFIDENTIAL. Sin migraciones, dependencias, PRD, Portal,
finanzas, inventario, estudios/pesos, vacunas, consultas o vínculos nuevos.
[[TD-055]] se reduce a entrada/corrección de estudios y pesos; unidad de peso
sigue propuesta en DEC-084. Ver [[UX-015-VALIDATION-2026-10-30]] para evidencia
simulada, PostgreSQL desechable de comandos/auditoría y revisión visual no
ejecutada.

## Registrar y corregir estudios — UX-016

Registrar estudio desde sección y Corregir estudio desde detalle fresco. Tipo
requerido hasta 2000 caracteres, fecha/hora de realización Paraguay y resultado
hasta 10000. Resultado puede quedar sin texto: se crea/vacía con string vacío,
no null ni estado inferido. Multilínea preservada como texto literal en
formulario, revisión y detalle; sin interpretar HTML.

POST `/patients/:patientId/clinical/studies` y PUT
`/patients/:patientId/clinical/studies/:id` existentes, sin esquema/contrato
backend nuevo. Revisión y confirmación antes de escribir. PUT solo campos
modificados, sin alterar fecha precisa cuando cambian tipo o resultado. La fecha
editada se convierte con helper de agenda independiente de zona del navegador, a
precisión de minuto. Relectura antes de PUT bloquea cambios remotos visibles en
campos modificados, sin prometer compare-and-swap.

Auditoría existente co-commit con actor/tenant/campos, sin texto clínico en
metadata. Servicio reafirma veterinary/create/update y usa tenant del contexto;
HTTP mantiene staff/membresía. Proxy endurece solo escrituras de estudios con
cookie staff, body exacto, rechazo de queries/claves extra y private,no-store;
no propaga aborto de comandos como garantía de rollback. Contratos previos de
tratamientos y demás registros preservados.

Cliente sin retry automático, guardia de doble envío y bloqueo ante respuesta
incierta (red/408/5xx/DTO ilegible); revisar guardado antes de volver a
intentar. Éxito confirma, abre detalle y reconsulta conservando filtros/página
por paciente. Cancelación con cambios o clic de salida requiere confirmación;
beforeunload advierte. Sin autosave, Storage, persistencia, URL o logs de
campos. No recuperación tras recarga/sesión, Back-Forward o navegación
programática. TD-066 aplica a tratamientos y estudios: sin
versión/idempotencia/historial previo de valores.

Permisos frontend opcionales conocidos ocultan create/update independientemente;
shell actual no suministra claims, con rechazo API explícito como autoridad.
Español/es-PY, tokens semánticos, etiquetas y foco. Sin nuevas rutas, permisos,
dependencias, archivos, Portal, consultas, prevención, vínculos, stock o
finanzas. TD-055 se reduce a entrada/corrección de pesos y definición de unidad
pendiente DEC-084. Evidencia en [[UX-016-VALIDATION-2026-10-30]], separando
simulación, PostgreSQL real desechable y visual/E2E no ejecutado.

## Unidad de peso aprobada — DEC-084, 2026-10-30

Producto aprobó KG para nuevas cargas staff, valores positivos exactos de hasta
tres decimales. PRD §12.1 actualizado por la decisión explícita. Históricos y
consumidores antiguos sin unidad conservan la cantidad y la unidad desconocida;
sin backfill/conversión automática ni mezcla con KG para derivaciones clínicas.
La aprobación es documental: el modelo, los DTO y UX-014 siguen sin unidad hasta
implementar la Story correspondiente. TD-055 permanece abierto para
entrada/corrección y materializar la definición; no se anuncia como capacidad ya
desplegada.

## Registrar y corregir pesos en kg — UX-017

Implementa DEC-084: nuevas cargas staff envían unit KG y cantidad positiva
exacta Decimal(10,3), hasta siete enteros y tres decimales. Entrada con coma y
presentación es-PY. Validación Zod y servicio rechazan precisión/rango extra sin
redondeo ni floats. Registrar peso desde listado y Corregir peso desde detalle
fresco; revisión y confirmación antes de escribir. Corregir valor desconocido
exige checkbox explícito para atribuir KG. Cambiar solo fecha puede conservar
unidad desconocida; PUT parcial omite el instante original si no se modifica.

ClinicalWeight.unit nullable enum KG, migración
20261030000001_clinical_weight_unit sin default ni UPDATE/backfill. Cantidades
previas intactas. El DDL reproducible se probó en bases desechables, sin aplicar
cambios sobre base operativa ni convertir datos. Para usar el nuevo código con
una base existente deberá desplegarse ese esquema por el flujo habitual.

POST/PUT existentes aceptan unit KG opcional. Sin unidad explícita: crear guarda
null; cambiar cantidad guarda null incluso si antes era KG; fecha sola preserva
unidad. Confirmar solo unit KG conserva cantidad y fecha exactas. Auditoría
atómica de campos/actor/tenant, sin valores clínicos. Los DTOs legados GET y
respuestas de comandos siguen sin unit; no se cambian Portal ni consumidores. La
proyección staff paginada/detalle incluye unit KG/null. La UI relee tras comando
antes de mostrar la unidad: un fallo entonces se trata como respuesta incierta,
sin repetir la escritura.

Filtro unit all/KG/unspecified. Rango requiere unidad seleccionada; all con
rango se rechaza. Rango legado sin unit filtra solo desconocidos; sin rango ni
unit devuelve ambas clases. La UI muestra kg o ausencia explícita, nunca infiere
unidad. Contexto temporal de filtros/página por paciente, sin Storage, URL o
logs clínicos. Valores/unidad son CONFIDENTIAL. Sin gráficos, conversiones o
interpretación de peso actual.

Guardias de doble envío y resultado incierto; prelectura parcial sin CAS, sin
retry ni idempotencia. Cancelar/salir por enlace y beforeunload advierten; sin
recuperación al desmontar, recargar o Back/Forward. Claims conocidos ocultan
acciones; shell sin claims mantiene API autoritativa. Staff/membresía,
veterinary, create/update/read y aislamiento backend preservados. TD-055
resuelto funcionalmente; TD-066 sigue abierto. Evidencia simulada y PostgreSQL
separadas en [[UX-017-VALIDATION-2026-10-30]]; visual/E2E no ejecutado.

## Recuperación temporal de formularios especializados — UX-018

Tratamientos, estudios y pesos conservan una copia de trabajo al desmontar con
cambios durante navegación interna. Un slot por paciente/tipo, con baseline,
campos exactos (vacíos/multilínea, fecha local, coma/confirmación KG), token de
generación y vencimiento de diez minutos. QueryClient existente, memoria del
mismo documento; nunca dehydrate/Storage/URL/logs. Contenido CONFIDENTIAL. No es
una nueva entidad persistente ni autosave.

Al volver, lista fresca autorizada antes de mostrar Recuperar cambios o
Descartar copia temporal. No basta el cache anterior. Recuperar comprueba acceso
con una nueva lectura; para corregir compara todos los campos/instante/unidad
del detalle con el baseline. Si cambiaron, muestra la copia aparte y bloquea
aplicarla. Error temporal conserva copia y permite reintentar; 401/403/404 la
eliminan sin exponer contenido. Claims conocidos exigen create/update según
modo; desconocidos conservan API autoritativa al escribir, sin afirmar que una
lectura concede permiso de escritura.

Recuperar requiere acción manual y luego revisión/confirmación normal; conserva
contexto de listado y precisión del instante que no se edita. Guardar, descartar
o vencer limpia copia; cancelar descarte la conserva. Formulario limpio no
produce borrador y deshacer todos los cambios recuperados no resucita la copia.
Advertencias de enlaces y beforeunload existentes siguen vigentes. Back/Forward
o navegación programática no se interceptan: la recuperación atiende su
remontaje en el mismo documento, sin parchear router/history.

Comandos en vuelo al salir quedan pendientes y bloqueados para reenvío. La copia
se puede consultar o descartar tras advertir que no se cancela el comando. Éxito
tardío limpia solo su token e invalida lecturas; respuesta incierta queda
bloqueada, sin inferir éxito por similitud de valores ni repetir
automáticamente. Respuestas antiguas no borran copias nuevas. Expirar esta
memoria no proporciona idempotencia durable. No se recupera tras reload, cerrar
pestaña, logout o nuevo login/documento; la sesión UX-007 conserva sus
fronteras.

Sin API, contrato, migración, dependencia, PRD o cambios financieros. TD-066
resuelto solo para pérdida inmediata por desmontaje, permanece abierto para
concurrencia, idempotencia y QA visual/E2E. Ver
[[UX-018-VALIDATION-2026-10-30]]: pruebas simuladas de componentes, sin
PostgreSQL ni navegador en esta etapa.

## Creación idempotente — UX-019

Esta sección supera las limitaciones de POST de UX-015–018 descritas arriba; PUT
conserva sus límites de concurrencia y respuesta incierta.

POST de treatments, studies y weights admite idempotencyKey UUID opcional en el
body JSON estricto. Sin clave conserva el contrato y no deduplica. Sin rutas,
permisos o proyecciones Portal nuevos. La clave nunca concede acceso: cada
replay exige autenticación/membresía staff, veterinary, vet.clinical.create y
paciente de la organización actual; paciente ajeno sigue devolviendo 404.

Ámbito: (tenantId del contexto, patientId autorizado, tipo, UUID normalizado a
minúsculas). Una clave puede usarse independientemente en distintos ámbitos.
Misma clave/contenido devuelve exactamente el DTO original, incluyendo ID y
fechas de creación, aun tras correcciones posteriores. Mismo ámbito con otro
contenido devuelve 409 CONFLICT y mensaje estable Clinical creation key was
already used for different content. Sin nueva fila clínica ni auditoría. No se
acepta idempotencyKey en PUT, búsquedas o otros comandos clínicos.

Fingerprint SHA-256 de campos explícitos en orden estable: instantes UTC,
Decimal exacto sin ceros irrelevantes, unidad KG o null y contexto omitido/null
normalizados; textos conservan espacios, mayúsculas y vacíos. Resultado vacío
sigue siendo string. Los campos de autoridad/clave no integran el contenido. Un
hash no anonimiza información clínica ni permite registrar su contenido.

ClinicalCreationReceipt conserva requestHash y snapshot del DTO allowlisted; FK
compuesta al paciente del mismo tenant, PK por ámbito y trigger inmutable.
Migración 20261030000002_clinical_creation_receipt: DDL aditivo sin backfill,
conversión o purga. Un advisory transaction lock por hash del ámbito serializa
intentos, con aislamiento ReadCommitted explícito: lock, registro, auditoría y
recibo se confirman juntos; una colisión de hash de lock solo serializa ámbitos
independientes. No hay llamadas externas dentro de la transacción. Rollback de
auditoría o recibo revierte todo y deja la clave disponible para reintento.

Frontend: UUID aleatorio por intento lógico, comando congelado desde su primer
envío, confirmación/reintento explícitos y cero retries automáticos. Tras error
de red/408/5xx/respuesta inválida puede repetir solo ese comando/clave; edición
de sus campos queda bloqueada. PUT incierto y POST en vuelo siguen bloqueados.
La recuperación UX-018 retiene comando, clave y, para pesos confirmados, ID en
la copia por paciente/tipo: lectura fresca autorizada antes de recuperar y nueva
revisión antes de enviar. No deduce éxito comparando valores. Copias previas sin
clave/comando no adquieren capacidad de reenvío incierto.

El peso conserva la respuesta de comando legada sin unidad. Al recibir su ID lo
conserva antes de releer detalle staff; si falla esa lectura, el reintento es
solo GET de ese ID, validando de nuevo KG/null y la proyección. Si se pierde la
propia respuesta de POST, repite el POST idempotente y después relee unidad. Una
corrección concurrente puede aparecer en la lectura staff, sin atribuirle los
valores del comando original ni inventar unidad. Sin conversiones/Number.

Transición compatible y segura ante versiones distintas: la UI nueva envía la
clave en JSON, nunca en header/URL. Una API anterior con body estricto la
rechaza antes de guardar; no puede ignorarla y aceptar una creación sin
protección. Primero desplegar esquema/API y luego UI. Un esquema faltante falla
la operación con clave; no hay fallback silencioso a una escritura no
idempotente. Consumidores legados sin clave siguen funcionando. No se despliega
en esta tarea.

Datos CONFIDENTIAL: ámbito, UUID por asociación clínica, digest y snapshot; solo
uso interno staff autorizado, sin logs, exports nuevos o Portal. UUID sin
contenido clínico. Misma clasificación en backups. Recibos durables sin TTL o
borrado automático: no se inventa política de retención destructiva. La copia de
formulario conserva diez minutos en QueryClient del documento, sin Storage,
URLs, logs o persistencia/deshidratación. Expiración, descarte o nuevo documento
pierden la clave local: volver a registrar es otro intento, no una promesa de
recuperación durable. Descartar no cancela un envío ni elimina un recibo.

Ver [[UX-019-clinical-create-idempotency]] y [[UX-019-VALIDATION-2026-10-30]].
TD-066 sigue abierto para PUT/CAS/historial, recuperación durable y validación
visual/E2E. Sin cambios de consultas cerradas, vacunas, desparasitación,
vínculos, finanzas o inventario.

## Correcciones con control de versión — UX-020

Esta sección supera el límite de concurrencia PUT de UX-015–019 para clientes
que adoptan expectedVersion. No agrega historial ni modifica consultas cerradas.

ClinicalTreatment, ClinicalStudy y ClinicalWeight tienen version integer
positivo, default 1. Migración 20261030000003_clinical_record_version: solo DDL
reproducible; inicialización técnica por DEFAULT, sin convertir contenido,
fechas, cantidades ni unidades. Un trigger BEFORE UPDATE incrementa OLD.version

- 1 en cualquier escritura (incluidos clientes legados y valores repetidos) e
  ignora una versión propuesta por un escritor. No depende de updatedAt ni de
  que dos guardados tengan timestamps distintos. Overflow rechaza la
  transacción, nunca reinicia silenciosamente la versión.

GET staff .../{treatments|studies|weights}/:id devuelve version junto con los
campos clínicos en un único SELECT scoped por tenant/paciente/ID; no hay ventana
entre leer contenido y versión. Listas y respuestas de comandos legadas
conservan forma, incluido peso sin unidad en el DTO de comando. DTOs staff son
allowlisted; las consultas SQL explícitas evitan reemplazar el cliente generado
que usan los procesos activos durante la validación. Esquema Prisma describe los
campos y se valida/genera en una copia aislada.

PUT existentes aceptan expectedVersion entero opcional 1..2147483647. Con el
token: SELECT version FOR UPDATE scoped por tenant/paciente/ID, comprobación,
update y auditoría en la misma transacción ReadCommitted. No se libera el lock
antes de guardar; el trigger incrementa dentro de la transacción. No se amplía
el contrato a Portal u otros registros. Versión distinta devuelve 409 CONFLICT
con mensaje estable Clinical record version changed.; inexistente/ajeno/otro
paciente devuelve el mismo 404 NOT_FOUND antes de exponer cualquier versión.
Permisos vet.clinical.update y entitlement veterinary siguen en servicio y
staff/membresía en la cadena HTTP. Ningún token concede autorización.

Una corrección ganadora produce una auditoría; conflicto no modifica contenido,
versión ni auditoría. Fallo de auditoría revierte también el incremento. Body
vacío sin cambios clínicos comprueba expectedVersion si llegó, pero no hace
UPDATE/incremento/auditoría. Campos presentes, aunque repitan valores, siguen
siendo comandos auditados y avanzan la versión, como las correcciones legadas.
La versión por sí sola no demuestra quién cambió el registro ni si un comando
con respuesta perdida fue el que ganó: no es idempotencia de PUT.

Transición: expectedVersion omitida conserva PUT legado sin protección contra
sobrescritura, y el trigger avanza versión para los nuevos consumidores. Una
escritura legada puede aún sobrescribir otra corrección: la garantía CAS solo
aplica al escritor que envía el token. No se promete una garantía global
mientras haya clientes legados sin token. Su migración obligatoria necesita una
etapa explícita. Una API anterior estricta rechaza expectedVersion antes de
escribir; la UI nueva nunca cae a un PUT sin token. Esquema/API antes de UI; sin
despliegue o migraciones operativas en esta tarea.

UI: baseline con versión válida obligatorio; antes de confirmar relee detalle y
compara versión, además de los campos editados. La transacción cierra la carrera
entre prelectura y PUT. Al 409 conserva texto/valores/instantes, bloquea enviar
ese baseline y ofrece Consultar registro actual (solo GET, con contenido
aparte). Para corregir de nuevo se cancela/descarta explícitamente la copia y se
inicia una nueva corrección desde detalle actualizado. No reemplaza
automáticamente el baseline, mezcla textos, rebasea o reintenta. Tokens técnicos
no se muestran como información clínica al usuario. UI con tokens
semánticos/es-PY, sin Number para pesos. Guardado incierto de PUT sigue
bloqueado: no se infiere éxito por valores ni se repite la escritura. Creaciones
UX-019 mantienen su clave/recibo/reintento.

La recuperación UX-018 incluye la versión en el baseline y exige igualdad en
lectura autorizada fresca, aun si los campos volvieron a coincidir; baseline sin
versión no habilita recuperar una corrección. Copia se muestra separada si hay
conflicto, con sus diez minutos de memoria por documento. Sin Storage, URL,
logs, persistencia durable o nueva política destructiva de retención. Version y
asociación clínica CONFIDENTIAL, solo staff autorizado; sin Portal, export nuevo
ni logging de contenido. Ver [[UX-020-clinical-correction-concurrency]] y
[[UX-020-VALIDATION-2026-10-30]]. TD-066 sigue abierta para historial,
recuperación durable y certificación visual/E2E.

## Validación clínica en navegador — UX-021

Lane opt-in: node scripts/verify-clinical-browser.mjs, configuración
apps/e2e/clinical.playwright.config.ts y clinical-specs/ separadas de la lane
general. PostgreSQL/Redis tmpfs propios, DB validada, identidades/pacientes
sintéticos, providers fake y builds temporales. No lee .env, usa base operativa,
reutiliza servidores dev o carga demo financiero. Cookie/BFF/API/PG reales.

Matriz de 16 casos: registro/corrección de tratamientos/estudios/pesos, fechas
Paraguay/Decimal exacto, commit correcto con respuesta perdida y replay tras
Atrás/Adelante, auditoría única, CAS con PUT interpuesto real, copia conservada
y lectura actual, recuperación/descarte móvil, sesión/permisos. Peso confirmado
repite solo GET; corregir fecha de peso legacy mantiene unidad desconocida.
Capturas desktop/móvil inspeccionadas.

Entrada por login→Inicio→Pacientes→ficha con enlaces reales y verificación de
mismo documento. TD-067 mitigada reubicando loading.tsx bajo el layout staff
asíncrono, de app/(app)/ a app/(app)/app/; mantiene shell/skeleton y memoria
UX-018 sin reload, cambio de CSP/prefetch o dependencias. Dos runners nuevos
consecutivos aprobaron 16/16, incluido el final sin instrumentación. UX-021
done; TD-066 open para historial, durable y escritores legados sin token.

No certifica todos los módulos/navegadores, móvil físico o lector de pantalla ni
atribuye con certeza la causa interna del router. Controles nativos pueden
seguir el locale del navegador. Traces con cookies sintéticas RESTRICTED y
capturas sintéticas CONFIDENTIAL, solo Temp; sin storageState persistido ni
retención destructiva nueva. Sin esquema/contrato clínico nuevo en UX-021, PRD,
base operativa, commit o push. Fallos previos, diagnóstico y verificaciones
separados en [[UX-021-VALIDATION-2026-10-30]].

## Consumidores de escritura protegida — UX-022

Los tres formularios staff son los únicos consumidores de aplicación de
creación/corrección de tratamientos/estudios/pesos encontrados en el
repositorio. Sus helpers writeTreatment/Study/Weight requieren intento con clave
UUID para POST y baseline con expectedVersion para PUT, tanto por overloads
TypeScript como antes de fetch. INVALID_WRITE_GUARD es un error local constante
(status 0, uncertain false), sin petición ni contenido. No generan nueva clave,
releen versión para forzar una corrección, reintentan o caen a contrato legado.

La recuperación conserva clave/comando/baseline. Peso con savedId confirmado
solo lee proyección staff, aun si la antigua clave es inutilizable; falla de
lectura no hace otra creación ni deduce unidad. Precisión y DTO legado intactos.
No hay campos persistentes nuevos, logging/URL/Storage de contenido o nueva
retención. Claves/versiones conservan clasificación CONFIDENTIAL.

API y BFF mantienen campos opcionales: consumidores legados siguen pudiendo
escribir sin protección; no se promete garantía global. Demo/fixtures directos
no son consumidores operativos. El inventario local no prueba ausencia de
clientes externos. [[UX-022-clinical-write-consumer-transition]] detalla el
mapa; [[DEC-085-clinical-write-legacy-contract-transition]] sigue proposed para
el corte público futuro, que requiere censo y aprobación explícita de
transición. No se activa obligatoriedad, modifica PRD ni altera otros registros
clínicos.

UX-022 verificada: 327 casos web/proxy, 29 backend simuladas, 51 PostgreSQL real
en contenedor temporal, lint/tipos y builds aislados aprobados. Sin ronda
visual/E2E nueva; [[UX-022-VALIDATION-2026-10-30]] documenta comandos y límites.

## Historial de correcciones por registro — UX-023 / DEC-086

Cada UPDATE futuro de tratamientos, estudios y pesos conserva antes/después
tipados e inmutables, versiones, actor/identidad histórica, motivo e instante de
corrección, en tres tablas Veterinary. Cantidades NUMERIC(10,3), KG/null y
fechas timestamptz(3) exactas; no conversión o historia previa inventada. La
primera corrección de un registro anterior conserva su estado previo real.

Migración 20261030000004_clinical_correction_history: FK compuesta a registro/
tenant/paciente y unicidad por versión posterior; triggers OLD/NEW y protección
contra UPDATE/DELETE de revisiones. Contexto de actor/motivo/revisionId local a
transacción, tomado del servidor; auditoría guarda IDs/campos, no contenido. El
comando confirma revisión/alcance/versión antes de auditar; captura ausente
revierte fila/versión/auditoría. Mutación/revisión/auditoría de aplicación
comparten commit/rollback. Direct SQL sin contexto queda con actor/motivo no
informados, sin inventar auditoría de aplicación. Conflicto, denegación y no-op
vacío sin revisión; campos presentes con valores iguales conservan semántica de
UPDATE/version/auditoría/historial. Replay de creación no genera revisiones ni
auditorías extra. PUT no se vuelve idempotente y un resultado incierto sigue
bloqueado.

PUT acepta correctionReason opcional no vacío/solo espacios, máximo 2000,
validado en schema/servicio; razón sola sin cambio de campos clínicos es no-op.
La UI nueva lo exige antes de confirmar y lo conserva/revisa con recuperación
UX-018. Legados omitidos muestran Sin motivo informado. DTOs de comando y unidad
desconocida de pesos intactos; peso confirmado solo reintenta GET.

API aditiva: GET /patients/:patientId/clinical/history-access (read, tenant,
veterinary; solo boolean allowed) y POST
.../clinical/{treatments|studies|weights}/:id/history/search (read +
vet.clinical.history_read, tenant/paciente/tipo/veterinary). Catálogo y
asignación inicial OWNER/ADMIN/VETERINARIAN, respetando permisos efectivos; no
checks de nombre de rol como autoridad. Search body beforeVersion opcional, 20
filas por página, cursor estricto por versión, DTO allowlisted/no-store. UUID
ajeno devuelve 404. BFF valida rutas/body/cookie staff y mantiene privados los
errores; no fabrica identidad, clave, motivo o versión.

Detalle ofrece Ver historial tras comprobar capacidad si la ficha no suministra
permisos; no convierte una caída de lectura en denegación definitiva. Historia
solo lectura con antes/después, actor/motivo, fechas es-PY/Paraguay precisas y
unidades explícitas, cursor en body y memoria del documento. No restauración,
edición/borrado/exportación de revisiones ni Portal. Snapshots, motivo, actor,
versiones/asociaciones CONFIDENTIAL; sin logs/URL/Storage de contenido o
política destructiva nueva. No se reconstruyen cambios anteriores desde
recibos/auditoría.

Ver [[UX-023-clinical-correction-history]] y [[UX-023-VALIDATION-2026-10-30]]:
624 casos distintos, incluyendo 72 PG y 17 E2E reales, seis capturas nuevas
inspeccionadas. PRD ampliado explícitamente por DEC-086 aceptada. No base
operativa, dependencias, commit/push. TD-066 conserva corte global/recuperación
durable, DEC-085 proposed.

## Borradores privados durables — UX-024 / DEC-087

PRD §13.3 aprobado explícitamente: guardar manualmente tratamientos/estudios/
pesos y recuperar tras recarga, solo autor con read + create/update según modo,
membresía/tenant/paciente/veterinary vigentes. Recuperar no escribe clínica. No
autoguardado o Storage del navegador; UX-018 temporal sigue disponible.

clinical_working_draft conserva copia discriminada, baseline completo, clave,
comando congelado, estado y versión propia. API aditiva bajo
/patients/:patientId/clinical/drafts: POST search, GET/PUT :id, POST :id/submit,
:id/complete y :id/discard. Search devuelve hasta 20 copias activas/pendientes
del autor/tipo, cursor UUID en body; sin promesa de orden cronológico. DTOs
allowlisted y private/no-store, UUID ajeno 404, sin permisos por nombre de rol.

Save tiene CAS y replay seguro con mismo ID/versión/payload. Antes de dispatch,
PENDING/comando y auditoría se confirman; la escritura clínica conserva su
transacción existente. Creación reutiliza comando/clave; corrección PENDING no
se reenvía, incluso si falló antes de escribir. No se vuelve idempotente PUT ni
se deduce éxito por valores. Peso consulta recibo autoritativo al recuperar: ID
confirmado ⇒ GET de proyección staff, sin otra creación por fallo de lectura.

El cliente acusa complete después de recibir DTO válido/proyección de peso;
fallo de acuse conserva PENDING conservador, no altera el éxito clínico.
Complete/ discard lógicos y auditados retiran la lista recuperable, conservan
contenido y no cancelan un comando enviado. Sin purga, backfill o borrado
físico/de backups. Trigger protege copias terminales e intentos congelados y
rechaza DELETE. Contenido/autor/asociaciones/baseline/claves CONFIDENTIAL, no
payloads en logs.

UX-024 done tras UX-025: retirada de loading.tsx global redundante, estados de
carga/error cliente y RouteFeedback conservados, sin reload o cambio de
auth/CSP/Next. Dos lanes completas independientes con 26/26 cada una: los 25
flujos clínicos y 50 contextos fríos por ronda, mismo documento y carga de
paciente retenida comprobados. TD-067 resolved para esta reproducción, sin
certificación universal. Ver [[UX-024-VALIDATION-2026-10-31]] y
[[UX-025-VALIDATION-2026-10-31]]; fallos iniciales conservados.

DEC-085 revisada y aceptada antes de producción: exigir clave en creación y
baseline/motivo en corrección será UX-026 (planned), sin transición prolongada
para consumidores controlados. Hasta su implementación, API/BFF actuales
mantienen opcionalidad documentada. No retirar fallback histórico de motivo/
unidad, alterar DTO de peso ni aplicar migraciones sobre base dev.
