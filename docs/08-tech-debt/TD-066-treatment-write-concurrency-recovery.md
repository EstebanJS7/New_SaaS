---
id: TD-066
type: tech-debt
title: Clinical record write concurrency and uncertain response recovery
status: open
severity: medium
owner: engineering
related_stories:
  [
    UX-015,
    UX-016,
    UX-017,
    UX-018,
    UX-019,
    UX-020,
    UX-021,
    UX-022,
    UX-023,
    UX-024,
  ]
created: 2026-10-30
updated: 2026-10-31
---

# TD-066 — Concurrencia y respuesta incierta de registros clínicos

Estado previo a UX-019: la API de registros especializados no tenía versión/ETag
ni clave de idempotencia en POST. PUT actualiza campos del mismo registro y
audita; no es el amendment versionado de una consulta cerrada. No cambiar esos
contratos silenciosamente para extender la UI.

UX-015 envía solo campos cambiados y relee antes de corregir, bloqueando cambios
visibles en esos campos. Persiste una ventana de carrera entre GET y PUT; no
garantiza compare-and-swap ni historial de valores anteriores. POST puede
haberse guardado si se perdió la respuesta: no se reintenta automáticamente y se
bloquea reenvío desde ese formulario, indicando revisar el listado.

Antes de UX-018, los formularios conservaban contenido solo mientras montados y
advertían al cancelar, recargar/cerrar o hacer clic en enlaces de salida.
Back/Forward o navegación programática no quedan interceptados ni se recupera
borrador tras desmontar, recarga/reingreso. No hay almacenamiento persistente;
no confundir estas protecciones con recuperación de borrador de encuentros en
TD-065.

Trabajo futuro: definir contrato compatible de concurrencia, idempotencia y
recuperación verificable de comandos; evaluar recuperación temporal autorizada
de formularios y E2E de navegación/sesión. Exige Story propia, pruebas de
carreras y acuerdo de contrato; no se presenta como implementado en UX-015.

## Extensión UX-016 — estudios

Las mismas fronteras se aplican a estudios: PUT parcial con relectura previa no
es CAS, POST no tiene idempotencia, respuesta incierta exige revisión manual y
el formulario no se recupera tras desmontaje/recarga/Back-Forward. Estudios usa
result string (vacío permitido), distinto del context nullable de tratamientos;
no se introduce un contrato genérico que borre esa diferencia. No se aprobaron
versiones ni cambios del PRD al extender la superficie.

## Extensión UX-017 — pesos y seguimiento visual

Pesos comparte PUT parcial/relectura sin CAS, POST sin idempotencia y borrador
solo mientras está montado. Después del comando se relee el detalle staff para
obtener unidad autoritativa: si esa lectura falla, el comando puede estar
confirmado y se bloquea reenvío hasta revisar manualmente el listado. No se
deduce KG de la respuesta legada, que conserva su DTO sin unidad.

TD-055 cierra la falta funcional de formularios. Sigue pendiente una ronda
visual/Playwright de las superficies especializadas y su navegación/sesión; las
pruebas de componentes, proxy y PostgreSQL no la sustituyen. No se ejecutó en
UX-015/016/017 por el alcance acordado. Esta deuda permanece open.

## Resolución parcial — UX-018, 2026-10-30

Tratamientos, estudios y pesos retienen una copia por paciente/tipo al salir por
navegación interna, hasta diez minutos en QueryClient del documento. Lectura
fresca autorizada antes de ofrecer Recuperar/Descartar; recuperar relee permisos
de lectura y detalle actual de correcciones. Baseline distinto bloquea aplicar
la copia y la muestra separadamente. El backend conserva la autoridad de
create/update en el comando; claims conocidos restringen recuperación.

No hay escritura automática, Storage, URLs o logs de contenido. La copia incluye
campos exactos/baseline, no un formulario genérico Core. Éxito, descarte y
expiración la eliminan; 401/403/404 no exponen contenido y descartan copia. Un
fallo temporal permite reintentar lectura. Al recuperar se exige revisión normal
antes de guardar. Deshacer todos los cambios no resucita la copia anterior.

Comando en curso al desmontar retiene estado pendiente, sin reenvío. Éxito
tardío limpia solo su generación e invalida lecturas; fallo incierto conserva
copia bloqueada para consulta y revisión manual. Descartar una copia no cancela
un comando enviado. Respuestas de un formulario anterior no eliminan un borrador
nuevo. La protección temporal vence a los diez minutos: no sustituye
idempotencia durable ni prueba que una operación no se guardó.

Se resuelve la pérdida inmediata por desmontaje dentro del mismo documento. Esta
deuda sigue open: CAS/versiones, idempotencia POST, recuperación durable o tras
recarga/reingreso, QA visual/Playwright y validación real de navegación siguen
pendientes. Sin cambio de API/esquema/PRD. Ver
[[UX-018-clinical-record-form-recovery]] y [[UX-018-VALIDATION-2026-10-30]].

## Resolución parcial — UX-019, 2026-10-30

Se resuelve idempotencia de creación de tratamientos/estudios/pesos con clave
JSON opcional y recibo transaccional durable; replay de DTO original y conflicto
409 por contenido distinto. Registro/auditoría/recibo atómicos, carreras reales
PostgreSQL y rollback verificados. Contratos sin clave preservados. UI nueva
conserva clave/comando, permite reintento manual seguro incluso al recuperar
UX-018; pendientes y PUT inciertos continúan bloqueados. Peso confirmado
conserva ID y reintenta solo lectura staff si falla, sin otra creación ni unidad
inferida.

Esta sección supera los límites históricos de POST/respuesta perdida anotados
arriba. Claves y snapshots CONFIDENTIAL sin purga automática; la recuperación
local sigue limitada a diez minutos por documento. Migración solo en PostgreSQL
desechable, nunca sobre base configurada ni datos operativos. Sin PRD nuevo.

Permanecen abiertos: concurrencia de correcciones PUT, CAS/ETag, historial de
valores, recuperación durable/tras recarga, y certificación visual/E2E de
navegación/sesión/accesibilidad. No se afirma que simulación ni PostgreSQL los
cubran. [[UX-019-VALIDATION-2026-10-30]] distingue las evidencias.

## Resolución parcial — UX-020, 2026-10-30

Correcciones de tratamientos/estudios/pesos admiten expectedVersion opcional;
versión del detalle staff leída junto con contenido, lock transaccional antes de
comprobar/guardar y 409 sin efectos para baseline obsoleto. Triggers avanzan
versión en todos los UPDATE, incluidos legados; rollback de auditoría revierte
contenido y versión. Sin dependencia de timestamps, historial o ETag HTTP.

UI requiere versión, conserva copia ante conflicto y ofrece lectura actual
separada; no rebasea ni reintenta. Recuperación temporal compara versión además
de contenido y mantiene guardias de PUT pendiente/incierto. UX-019 intacta. PUT
sin token sigue legado: puede sobrescribir cambios, aunque incrementa versión
para que los nuevos clientes detecten la escritura. Obligar a los consumidores
legados a adoptar CAS requiere transición explícita; no se oculta este límite.

Resuelta la carrera GET→PUT para los clientes con token/UI actualizada.
Continúan pendientes: migración obligatoria de escritores legados, historial de
valores, recuperación durable/tras recarga y certificación visual/E2E de
navegación/sesión. Sin migraciones operativas, PRD, commit/push o cambios de
consultas cerradas. Ver [[UX-020-VALIDATION-2026-10-30]]; esta deuda permanece
open.

## Validación acotada en navegador — UX-021, 2026-10-30

Matriz real de 16 casos en Chrome headless y PostgreSQL/Redis propios, con
capturas desktop/móvil inspeccionadas. Cookie/BFF/API/PG/auditoría reales: los
tres tipos, commit con respuesta perdida y replay, CAS, Atrás/Adelante,
descarte, sesión/permisos, pesos exactos y unidad legacy desconocida.

La navegación intermitente inicial se diagnosticó en TD-067 y se mitigó
reubicando loading.tsx bajo el layout staff asíncrono. La lane entra ahora por
Inicio→Pacientes→ficha con enlaces reales/mismo documento. Dos runners desde
cero consecutivos aprobaron 16/16; final sin instrumentación, retries=0. UX-021
done, TD-067 resolved para el bloqueo observado; se conservan los fallos previos
y límites de causalidad/cobertura en [[UX-021-VALIDATION-2026-10-30]].

Esta deuda permanece open para historial de valores, recuperación durable/tras
recarga y transición obligatoria de escritores legados a CAS. Chrome Windows con
viewport móvil no certifica otros navegadores, equipo físico o lector de
pantalla. Sin base operativa, cambio de PRD, commit o push.

## Consumidores controlados — UX-022, 2026-10-30

Inventario local encontró tres formularios productivos ya protegidos, pero sus
helpers aún aceptaban omisión accidental de clave/versión. UX-022 exige ambas
según modo en tipos y runtime antes de red, conserva intento/baseline de
recuperación y GET-only para peso confirmado. No genera guardias en transporte
ni BFF. Fixtures/demo directos no equivalen a consumidores externos.

Backend/BFF siguen compatibles y campos opcionales; el censo local no permite
retirar esa compatibilidad o afirmar garantías globales. DEC-085 proposed
documenta el corte futuro por etapas, con migración/verificación de
integraciones y decisión explícita antes de exigir campos. Esta deuda continúa
open para ese corte, historial y recuperación durable. Sin esquema/retención
nueva.

UX-022 done para el alcance compatible; 407 pruebas distintas y builds/lint/
tipos aprobados. [[UX-022-VALIDATION-2026-10-30]] separa simulación, PostgreSQL
real y navegador no ejecutado de nuevo. DEC-085 propuesta no activa el corte.

## Historial especializado — UX-023 / DEC-086, 2026-10-30

Se resuelve conservación/consulta de valores anteriores de futuras correcciones
de los tres tipos, con snapshots tipados, actor/nombre histórico, motivo e
instante, inmutabilidad y co-commit con auditoría. Legados también se capturan
sin motivo inventado; SQL sin contexto no recibe actor/auditoría ficticios. Sin
reconstruir cambios anteriores a activación ni deducir éxito por valores.

Motivo obligatorio en nueva UI, opcional en API compatible; historial por
registro con permiso vet.clinical.history_read más read/tenant/veterinary.
Capacidad backend para integrar permisos reales, paginación y datos exactos. El
comando confirma la revisión por ID/alcance/versión antes de auditar; captura
ausente revierte íntegramente, probado en los tres tipos con PG real. Ver
[[UX-023-VALIDATION-2026-10-30]] (simulación/PG/E2E separados).

La deuda sigue open exclusivamente para transición global de consumidores
legados (DEC-085 proposed) y recuperación durable/tras recarga. La validación
visual/E2E es acotada a Chrome Windows/viewport móvil, no certificación
universal o de accesibilidad. No nueva retención destructiva ni datos
operativos.

## Siguiente propuesta — 2026-10-31

[[DEC-087-durable-specialized-clinical-drafts]] aceptada explícitamente (1/1/1):
borradores en servidor tras recarga, guardado manual, autor privado y descarte
lógico sin purga automática. UX-024 in-progress y PRD §13.3 actualizado. La
evidencia final separará simulación, PG y recarga real; no anticipar cierre.
DEC-085 conserva por separado el censo/corte futuro de consumidores externos.
TD-067 se reabre por recurrencia de navegación antes de clínica en la primera
ronda de esta etapa; no se afirma resolución global del shell.

UX-024 implementa esa recuperación manual y privada, con estado PENDING durable
antes de dispatch, comando/clave congelados, bloqueo de PUT incierto tras
recarga, recibo autoritativo para peso GET-only, CAS de borrador y
cierre/descarte lógicos auditados sin purga. 675 casos estáticos/simulados/PG
aprobados; QA de navegador separa selecciones y no declara una lane completa
verde. La deuda no se cierra: DEC-085 pendiente y TD-067 abierta; cierre UX-024
depende de sus gates.

## Cierre de navegación y pendiente actual — UX-025, 2026-10-31

UX-025 retiró la barrera global de carga redundante tras reproducción en el
décimo contexto nuevo. Dos lanes completas independientes 26/26 (25 flujos
clínicos más 50 contextos fríos por ronda) aprobaron, sin retries, conservando
documento/recuperación/carga cliente. UX-024 done y TD-067 resolved de manera
acotada; no se afirma estabilidad universal o certificación de otros
navegadores.

DEC-085 revisada/accepted por decisión explícita del usuario antes de
producción: no hace falta mantener transición prolongada de clientes antiguos
controlados. Pendiente UX-026 planned: exigir claves/versiones/motivos en
contratos backend/ BFF y actualizar consumidores/fixtures/pruebas conjuntamente.
Aún no está activo en código; esta deuda permanece open por ese pendiente. No
cambia precisión, unidades desconocidas, DTO de peso, retención o datos ya
guardados.
