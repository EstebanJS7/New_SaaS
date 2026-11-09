---
id: DEC-095
type: decision
title: How a clinic declares its fiscal issuance point
status: accepted
date: 2026-11-09
related_epics: [EPIC-16]
related_stories: [FISC-011, FISC-015, NCE-001, MB-002]
resolves: [TD-075]
prd_change_required: false
---

# DEC-095 — Cómo declara una clínica su punto de expedición fiscal

## Contexto

[[DEC-057]] (Q4) decidió que el perfil fiscal **declara** el establecimiento, el
punto de expedición y el tipo de documento con los que emite, sin inventar
valores por defecto, y que ese punto debe resolver a exactamente un rango de
timbrado `ACTIVE`. La migración `20261010000001_fisc_015_fiscal_identity` agregó
las tres columnas (`default_establishment_id`, `default_expedition_point`,
`default_document_type`) con sus CHECK, pero **ningún camino soportado las
escribe** ([[TD-075]]):

- `PUT /fiscal/emitter-profile` (`fiscal.profile.manage`) no acepta esos campos.
- Ningún seed, `provision-tenant.ts` ni script los carga; solo la suite live-pg,
  con SQL directo.
- La web no expone ninguna configuración fiscal: el proxy solo deja pasar
  `fiscal-documents`. El mensaje de rango faltante remite a «Configuración
  fiscal», una pantalla que no existe.
- El vínculo de sucursal ([[DEC-094]] §9, `PUT /branches/:id`) solo se consulta
  **después** de que el perfil declaró su punto, así que por sí solo no alcanza.

Consecuencias hoy: una factura se confirma con la numeración propia de Billing y
nunca obtiene identidad fiscal; una anulación con factura confirmada responde
`409` y la nota de crédito ([[NCE-001]]) es inalcanzable. Lo mismo vale para
establecimientos, rangos de timbrado y certificado: existen en la API, pero no
hay forma de cargarlos sin llamar la API a mano.

## Pregunta

¿Por qué camino declara una clínica su punto de expedición (y, con él, el resto
de su configuración fiscal), con qué validación y quién puede hacerlo?

## Opciones

### Opción A — Campo en la API y pantalla «Configuración fiscal» completa

Ruta dedicada `PUT /fiscal/emitter-profile/issuance-point` y una pantalla staff
con perfil, establecimientos, rangos de timbrado, certificado y punto de
expedición. Es la solución final, pero es una superficie grande (subida del
certificado, formularios con reglas SIFEN) antes de tener la primera clínica.

### Opción B — Campo en la API y alta fiscal por el operador

La misma ruta dedicada, más un comando de operador (`provision-fiscal`, hermano
de `provision-tenant.ts`) que carga perfil, establecimiento, rango y punto a
través de los **servicios** de la API (misma validación y auditoría), no por
SQL. Coherente con D2: las clínicas las da de alta el operador. La pantalla
queda para una Story posterior.

### Opción C — Usar el vínculo de sucursal como declaración

Si la sucursal tiene establecimiento y punto, emitir con ellos aunque el perfil
no declare nada. Cambia el contrato de DEC-057 (el tipo de documento sigue sin
declararse) y de DEC-094 §9, y no resuelve la carga de rangos ni del
certificado.

## Recomendación

**Opción A, en tres entregas de menor a mayor riesgo.** La API ya concede a
Propietario y Administración `fiscal.profile.manage` y
`fiscal.signing_material.manage`: el diseño espera que la clínica configure su
parte fiscal, y solo falta la superficie. La Opción B dejaría un comando de
operador descartable en cuanto exista la pantalla.

1. **Punto de expedición (API).** `PUT /fiscal/emitter-profile/issuance-point`
   con `{ establishmentId, expeditionPoint, documentType }`, permiso
   `fiscal.profile.manage`, tenant del contexto, auditoría
   `fiscal.issuance_point.declared` en la misma transacción. Validación al
   declarar (la de DEC-057 opción B, adelantada): el establecimiento es del
   tenant y `(establecimiento, punto, tipo)` resuelve a exactamente un rango
   `ACTIVE`; si no, `409` con un mensaje que nombra lo que falta. La respuesta
   informa si existe también un rango de nota de crédito (tipo 5) para ese
   punto, sin exigirlo. Desbloquea la prueba en navegador de NCE-001 sin SQL.
2. **Pantalla «Configuración fiscal», primera parte.** Perfil, establecimientos,
   rangos de timbrado (alta y retiro) y punto de expedición, sobre las rutas
   existentes; el proxy web agrega solo esas rutas. El mensaje
   `CREDIT_NOTE_NO_RANGE_MESSAGE` pasa a remitir a una pantalla real.
3. **Certificado de firma.** Subida y retiro del material de firma en su propia
   entrega y revisión: maneja secretos (riesgo alto, ítem 2).

## Impacto

### Producto

Ninguno sobre el alcance aprobado: completa la capacidad que DEC-057 ya decidió.
La clínica (Propietario/Administración) carga su configuración fiscal desde la
aplicación, sin tocar la base.

### Arquitectura

Sin cambios: una ruta nueva y una pantalla sobre servicios existentes. No es un
servicio desplegable ni una abstracción nueva.

### Base de datos/API

Sin migración (las columnas y CHECK existen). Una ruta nueva y aditiva; ningún
contrato existente cambia.

### Seguridad

Las rutas exigen sus permisos actuales y resuelven el tenant del contexto; la
web solo es UX. El certificado nunca se guarda ni se muestra en el navegador más
allá del envío; su entrega lleva revisión propia.

## Decisión

Aceptada por el usuario el 2026-11-09: Opción A en las tres entregas descritas.
