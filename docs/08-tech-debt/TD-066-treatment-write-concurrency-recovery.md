---
id: TD-066
type: tech-debt
title: Clinical record write concurrency and uncertain response recovery
status: open
severity: medium
owner: engineering
related_stories: [UX-015, UX-016, UX-017, UX-018]
created: 2026-10-30
updated: 2026-10-30
---

# TD-066 — Concurrencia y respuesta incierta de registros clínicos

La API existente de registros especializados no tiene versión/ETag ni clave de
idempotencia en POST. PUT actualiza campos del mismo registro y audita; no es el
amendment versionado de una consulta cerrada. No cambiar esos contratos
silenciosamente para extender la UI.

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
