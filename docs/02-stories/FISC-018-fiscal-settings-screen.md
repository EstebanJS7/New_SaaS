---
id: FISC-018
type: story
title: Fiscal settings screen (profile, establishments, ranges, issuance point)
epic: EPIC-16
status: in-progress
priority: high
depends_on: [FISC-011, FISC-017]
prd_sections: []
permissions: [fiscal.profile.manage]
branch: docs/dec-095-fiscal-issuance-point
created: 2026-11-09
updated: 2026-11-09
---

# FISC-018 — Pantalla «Configuración fiscal»

## Objetivo

Que Propietario y Administración carguen desde la aplicación el perfil fiscal,
los establecimientos, los rangos de timbrado y el punto de expedición, sin tocar
la base ni llamar a la API a mano. Segunda entrega de [[DEC-095]] (Opción A);
cierra [[TD-075]].

## Contexto

Las rutas existen en la API (`/fiscal/emitter-profile`,
`/fiscal/establishments`, `/fiscal/timbrado-ranges`,
`/fiscal/emitter-profile/issuance-point` de [[FISC-017]]), todas bajo
`fiscal.profile.manage`, pero el proxy web solo deja pasar `fiscal-documents` y
no hay pantalla. El mensaje de rango faltante de la nota de crédito remite a
«Configuración fiscal», que no existe.

## En alcance

- Proxy web: solo las rutas de perfil, establecimientos, rangos (listar, crear,
  retirar) y punto de expedición, con los mismos métodos que la API; todo lo
  demás sigue rechazado.
- Página `/app/settings/fiscal` con enlace «Configuración fiscal» en la sección
  «Configuración» del menú, visible solo con la función `fiscal`.
- Secciones: perfil del emisor; establecimientos (alta y edición); rangos de
  timbrado (alta y retiro con motivo); punto de expedición (elegir
  establecimiento, punto y tipo entre los rangos activos).
- `CREDIT_NOTE_NO_RANGE_MESSAGE` remite a esta pantalla con su nombre real.
- Prueba en navegador de NCE-001 usando esta pantalla.

## Fuera de alcance

- El certificado de firma (entrega 3 de DEC-095).
- Anular un rango ante SIFEN (`fiscal.range.void`): sigue solo en la API.
- Cambiar reglas de la API.

## Criterios de aceptación

- [ ] El proxy reenvía solo las rutas en alcance, con sus métodos; cualquier
      otra ruta o método fiscal sigue respondiendo `400`, y los ids viajan solo
      como UUID.
- [ ] El enlace aparece solo con la función `fiscal`; sin
      `fiscal.profile.manage` la página muestra un estado de permiso, no
      formularios.
- [ ] Perfil: se lee y se guarda; sin perfil, la página lo dice y ofrece
      crearlo.
- [ ] Establecimientos: listar, crear y editar.
- [ ] Rangos: listar, crear y retirar con motivo y confirmación explícita.
- [ ] Punto de expedición: muestra el declarado o que falta; declarar usa la
      ruta de FISC-017 y muestra sus `409` con el mensaje de la API; avisa si no
      hay rango de nota de crédito para ese punto.
- [ ] Cada sección tiene estados de carga, vacío, error y éxito; los textos en
      español (es-PY); solo tokens semánticos.
- [ ] El mensaje de rango faltante de la nota de crédito nombra esta pantalla.
- [ ] Tests de componentes y del proxy; prueba en navegador del recorrido de
      configuración y de NCE-001 (anular una venta facturada emite la nota de
      crédito).

## Decisiones / ADRs

- [[DEC-057]], [[DEC-090]], [[DEC-095]]
