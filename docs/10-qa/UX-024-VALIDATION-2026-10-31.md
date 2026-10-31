---
type: qa
status: passed
story: UX-024
date: 2026-10-31
updated: 2026-10-31
---

# UX-024 — Borradores privados tras recarga

## Autorización y alcance

Usuario aceptó 1/1/1: guardado manual, solo autor y descarte lógico sin purga.
DEC-087 accepted, PRD §13.3 explícito y Story libre UX-024 in-progress antes de
código; branch main, cambios acumulados conservados, sin commit/push. Reglas
AGENTS/ingeniería/documentación, PRD §§13/27/41, Clinical, DEC-084/087 y TD-066
revisados; no corte DEC-085, dependencias, servicios o bases operativas nuevos.

## Implementación

Migración 20261031000001_clinical_working_draft: Veterinary específico para tres
tipos, JSON discriminado/validado de campos incompletos y baseline original,
clave de creación, versión propia, autor/tenant/paciente, comando congelado y
estados ACTIVE/PENDING/COMPLETED/DISCARDED. FK compuesta a paciente, FK autor e
índice scoped. Trigger rechaza borrado físico, cambio de identidad, modificación
de intentos congelados y de copias terminales; no backfill o purga. Modelo
Prisma explícito, consultas raw limitadas a esta tabla/recibos/targets
allowlisted.

API aditiva /patients/:patientId/clinical/drafts: POST search (kind/before en
body, 20 filas/UUID cursor), GET :id, PUT :id (version/copy), POST :id/submit,
:id/complete y :id/discard. Auth/membresía + read + permiso create/update según
modo + veterinary + tenant/paciente/autor en backend; UUID ajeno 404. Search
filtra modos sin permiso. DTOs allowlisted, private/no-store. BFF cookie staff,
rutas/métodos/body allowlisted, sin queries; abort solo de lecturas.

Guardado manual con ID estable por intento y versión propia: replay del mismo
save perdido no duplica auditoría; otra pestaña con contenido distinto
recibe 409. Baseline completo y clave no se sustituyen. Antes de dispatch,
PENDING y comando se confirman con su auditoría; falla preparación ⇒ no
escritura clínica. La escritura clínica y su auditoría mantienen su propia
transacción UX-019/020; fallo posterior puede dejar PENDING conservador, no una
falsa copia sin enviar. No se afirma atomicidad entre esos dos commits
separados.

Creación PENDING repite exclusivamente comando/clave congelados. GET/search
consulta el recibo backend scoped para confirmedId, sin comparar valores. Peso
con ID confirmado solo GET de proyección staff; no crea al fallar lectura.
Corrección PENDING nunca se reenvía, incluso si el fallo ocurrió antes de
dispatch; conserva valores/motivo/baseline para revisión y descarte explícito.
Si el frontend recibe DTO válido (y proyección en pesos), confirma complete;
fallo de ese acuse no convierte éxito clínico en creación nueva. Queda copia
PENDING conservadora, descartable; no hay reconciliación automática de PUT.

Guardado, preparación, complete y discard tienen auditoría co-transaccional con
IDs mínimos, sin contenido. Complete/discard retiran lógicamente la copia de la
lista, conservándola en servidor. Descartar no cancela un comando enviado.
Contenido/asociaciones/claves/actor/baseline CONFIDENTIAL, sin Storage, URL o
logging de payloads; no expiración/purga ni promesa de eliminación de backups.

UI Guardar borrador + Borradores guardados por tipo, apertura/recuperación/
descarte explícitos. Consulta revalida copia al recuperar y usa el recibo más
reciente; errores de acceso retiran las copias mostradas. No autoguardado;
campos posteriores al save pueden perderse si no se confirma. Guardias bloquean
revisión y confirmación mientras el save esté pendiente o sin confirmación.
Cancelar permite volver a consultar las copias del servidor. UX-018 por
documento sigue intacta. Fechas de Paraguay, cantidades exactas/unidad
desconocida preservadas.

## Evidencia y fallos intermedios

- Web/proxy inicial: 395/395, 19 archivos; incluye 18 casos nuevos de
  transporte/ componentes y 18 BFF. Tres casos de carrera save/confirm
  agregados: final 398/398, 19 archivos, salida 0;
  Temp/ux024-web-final-tests.log. No sumar rondas.
- Backend simulado: 137/137 (25 HTTP, 13 records, 26 clinical, 20 treatment, 20
  study, 33 weight). Seis rutas draft comprueban auth/read/cross-tenant con
  guards reales y fixture DB simulada, no PostgreSQL.
- Database estático/simulado: 45/45 (reference-seed 30, schema-clinical 15).
- PostgreSQL real desechable: 25 creación + 47 corrección/historial + 23
  borradores, 95 casos. Primera corrida de borradores: 19/19 fallaron porque
  Prisma no deserializa void de pg_advisory_xact_lock. Se agregó cast a text;
  luego 19/19 y 23/23 aprobados. Final tras guardia del baseline: 25/25, 47/47 y
  23/23, salida 0; Temp/newsaas-ux024-EhldHx, pg-creation.log/pg-correction.log/
  pg-drafts.log, contenedor eliminado. No se usa simulación de locks como prueba
  de carreras ni se suman reejecuciones.
- Casos nuevos PG: save/replay, CAS simultáneo, dispatch simultáneo, respuesta
  perdida tras commit, recibo autoritativo de peso, comando diferente, fallo
  antes de dispatch, tres correcciones inciertas bloqueadas, actor/tenant/
  paciente/permisos/entitlement, rollback de auditorías (save/submit/discard/
  complete), congelación/retención DB y cursor de 20 sin duplicados.
- Prisma validate/generate aislados aprobados: Temp/newsaas-ux024-schema-XzCyOK,
  URL ficticia sin conexión; cliente dev/generated/dist no reemplazados.
- Primer lint web detectó String(RequestInfo/BodyInit) inseguro en tests; se
  reemplazó por guard de string. Primer types detectó uso de exact en consultas
  Testing Library y genéricos con callbacks heterogéneos en tests; corregidos.
  No se cambió producción para relajar tipos o instalar dependencias.

## Navegador real y revisión visual

Runner node scripts/verify-clinical-browser.mjs, Chrome Windows headless,
PG/Redis tmpfs propios, catálogos/datos sintéticos, API/web builds temporales,
puertos propios, sin .env o servicios dev. 25 casos (17 anteriores + 8 de esta
etapa): recarga real de los tres borradores, creación con respuesta perdida y
recuperación de los tres tipos, corrección incierta tras recarga, peso con fallo
de proyección y posterior GET-only. Screenshots previstos desktop/390 px.

Primera ronda newsaas-ux021-browser-yBnaL9: 12 passed, 1 failed, 12 no
ejecutados, salida 1. Falló navegación lista→ficha en open(), antes del caso de
relectura de peso y antes de los nuevos casos; no acreditó borradores. TD-067 se
reabrió: recurrencia no resuelta por la mitigación anterior. No retries, goto
sustituto, relajación de permisos o bypass del flujo.

Segunda ronda completa QSwVFe: 16 passed, 1 failed, 8 no ejecutados, salida 1.
Mismo síntoma de open(), esta vez antes del caso de lector/historial. Conserva
TD-067 abierta; tampoco acreditó los ocho casos nuevos. Código de navegación sin
cambios. No hay una lane de 25/25 verde en esta etapa.

Selección focalizada con --grep "manual draft|lost durable|uncertain
durable|durable receipt" desde cero LcGrcr: 6 passed, 1 failed, 1 no ejecutado.
Los seis prueban recarga real y creación con respuesta perdida para los tres
tipos; peso recupera ID de recibo y usa GET-only. Falló el test nuevo de
corrección por un paso redundante: tras guardar ya se abría detalle y el test
esperaba un botón Ver tratamiento de la lista. Se retiró ese paso del test, sin
cambiar producto ni saltar navegación.

Selección final --grep "uncertain durable|durable receipt", desde cero fweTkn:
2/2, salida 0, 20 s. Confirma corrección incierta bloqueada tras recarga y peso
con proyección post-commit fallida, recarga y recuperación GET-only (un solo
submit/creación/auditoría). Ocho casos nuevos aprobados entre las dos
selecciones, sin sumar repeticiones ni presentarlos como una ronda completa de
25 aprobados. Ambas selecciones conservaron login/enlaces reales, marca de
documento, retries=0, configuración/guards/BFF/API/PG reales y limpieza de
contenedores.

Se inspeccionaron seis capturas de LcGrcr/screenshots bajo Temp:
{treatment,study,weight}-draft-reload-{desktop,mobile}.png. Campos recuperados,
texto de privacidad/retención, contexto/resultados multilinea, 0,125 kg exactos,
botones y legibilidad/wrapping sin recortes en escritorio y viewport de 390 px.
Controles datetime-local conservan su presentación nativa según locale del
Chrome anfitrión (en esta lane en-US); valor/instante se interpreta
explícitamente en Paraguay, probado en datos. No se cambió esa semántica
heredada ni se afirma formato visual nativo es-PY independiente del navegador.
Capturas CONFIDENTIAL; traces fallidos con cookies sintéticas RESTRICTED, solo
Temp, no Git.

## Checks finales y pendiente para cierre

675 casos distintos automatizados aprobados: 398 web/proxy + 137 API simulados

- 45 database/esquema + 95 PG real. Ocho E2E nuevos aprobados por selección;
  regresión completa: 16 casos aprobados antes del fallo de navegación, uno
  fallido, ocho no ejecutados en esa ronda. No sumar cohortes como 25/25 verde.

Lint web/API/e2e aprobado; database aprobado con 12 warnings previos de console
en scripts no modificados, cero errores. Tipos web/API/e2e y builds aislados
API/database/reference/web y verificador Next aprobados. Prisma validate/
generate aislados arriba. Binarios instalados, sin reinstalar paquetes o
reemplazar outputs/cliente dev. Logs finales ux024-{api,web}-verified-*,
ux024-e2e-{types,lint}, ux024-database-{tests,lint}, ux024-schema-run en Temp.

UX-024 quedó review por la lane completa fallida y TD-067 abierta. La
implementación y verificación funcional focalizada no resolvían la intermitencia
global ni autorizaban ignorar ese gate; se exigió investigación acotada y
reejecución completa antes de cerrar. No CI remota, despliegue, Safari/Firefox,
hardware móvil, lector de pantalla o certificación de navegación universal. No
cambiar status done mientras haya gates requeridos pendientes o fallidos.

Revisión final: formato y git diff --check aprobados, contenedores propios
ux021/ux024 ausentes en docker ps -a, sin detener servicios dev. Escaneo acotado
de entradas JSON del servidor en los cuatro logs de navegador para cinco
marcadores clínicos sintéticos: cero coincidencias. No equivale a auditoría
integral de logging/traces. Sin base configurada, migración operativa, datos
operativos, instalación de paquetes, commit o push.

## Cierre de gate mediante UX-025 — 2026-10-31

[[UX-025-VALIDATION-2026-10-31]] documenta reproducción en contexto frío 10,
retirada de la barrera global Next redundante y dos lanes nuevas independientes:
rXaXqy 26/26 (7,0 min) y PX3EwT 26/26 (5,9 min), ambas salida 0/retries=0. Cada
una incluye los 25 casos clínicos de esta etapa más 50 contextos fríos con
login/enlaces/documento conservado y comprobación de carga cliente. TD-067
resolved para esta matriz, sin afirmar ausencia universal. Gates satisfechos;
UX-024 done. No se borran fallos previos ni se suman rondas como casos nuevos.
