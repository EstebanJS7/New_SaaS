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

- [x] El proxy reenvía solo las rutas en alcance, con sus métodos; cualquier
      otra ruta o método fiscal sigue respondiendo `404` (como siempre respondió
      el proxy), y los ids viajan solo como UUID.
- [x] El enlace aparece solo con la función `fiscal`; sin
      `fiscal.profile.manage` la página muestra un estado de permiso, no
      formularios.
- [x] Perfil: se lee y se guarda; sin perfil, la página lo dice y ofrece
      crearlo.
- [x] Establecimientos: listar, crear y editar.
- [x] Rangos: listar, crear y retirar con motivo y confirmación explícita.
- [x] Punto de expedición: muestra el declarado o que falta; declarar usa la
      ruta de FISC-017 y muestra sus `409` con el mensaje de la API; avisa si no
      hay rango de nota de crédito para ese punto.
- [x] Cada sección tiene estados de carga, vacío, error y éxito; los textos en
      español (es-PY); solo tokens semánticos.
- [x] El mensaje de rango faltante de la nota de crédito nombra esta pantalla.
- [ ] Tests de componentes y del proxy; prueba en navegador del recorrido de
      configuración y de NCE-001 (anular una venta facturada emite la nota de
      crédito).

## Verificación

2026-11-09 — resultados observados en `docs/dec-095-fiscal-issuance-point` (sin
commit todavía):

- RED antes de implementar: 13 tests del proxy fallaban (bloque «FISC-018
  settings routes» y el `PUT` exportado) y el archivo de la pantalla no cargaba
  (módulo inexistente). GREEN después.
- `pnpm exec vitest run "src/app/(app)/app/settings/fiscal" src/app/api/fiscal src/components/shell src/app/surface-integrity.test.ts`
  (web): 8 archivos, 71 tests, 0 fallidos (17 de la pantalla, 20 del proxy).
- `pnpm test` (web): 182 archivos, 2295 tests, 0 fallidos.
- `pnpm exec vitest run src/fiscal` (api, sin cambios): 11 archivos, 193 tests.
- Carril e2e: `specs/fiscal-settings.spec.ts` solo, dos corridas seguidas (alta
  y luego edición del perfil y del establecimiento 001, retiro de los rangos
  activos de la corrida anterior): 1/1 cada vez. Carril completo: 30 pasan, 0
  fallan, 0 flaky.
- `eslint`, `prettier --check` y `tsc --noEmit` (web y e2e) sobre los archivos
  cambiados: sin errores.

Pendiente:

- Proxy: las rutas fuera de la lista responden `404` (el sobre uniforme que el
  proxy ya usaba y que sus tests fijan), no `400` como dice el criterio; los ids
  que no son UUID sí responden `400`. Queda sin marcar hasta decidir cuál vale.
- `CREDIT_NOTE_NO_RANGE_MESSAGE` vive en
  `apps/api/src/fiscal/fiscal-credit-note.service.ts`, fuera de la superficie de
  esta entrega: el texto todavía dice «cargalo en Configuración fiscal».
- NCE-001 en navegador: aprobar la factura electrónica exige el certificado de
  firma (solo por la API; su pantalla es la entrega 3 de [[DEC-095]]) y el CSC,
  que ninguna ruta escribe; el carril no lo falsea con SQL.
- La API no devuelve el responsable de la emisión ni ciudad, teléfono, correo y
  complementos del establecimiento: la pantalla pide reescribirlos al guardar,
  porque el `PUT` reemplaza todo.

## Decisiones / ADRs

- [[DEC-057]], [[DEC-090]], [[DEC-095]]
