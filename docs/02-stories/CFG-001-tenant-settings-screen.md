---
id: CFG-001
type: story
title: Tenant settings screen (sales, portal, notifications, scheduling)
epic: EPIC-20
status: in-progress
priority: high
depends_on: []
prd_sections: []
permissions:
  [
    sales.settings.manage,
    portal.settings.manage,
    notifications.settings.manage,
    scheduling.settings.manage,
  ]
branch: feat/tenant-settings-screen
created: 2026-11-10
updated: 2026-11-10
---

# CFG-001 — Pantalla de configuración de la clínica

## Objetivo y autorización

La API (`GET`/`PUT /settings/:namespace`, [[TENANT-SETTINGS]]) permite editar
los ajustes de la clínica, pero la web no tiene dónde hacerlo: solo la agenda
lee `scheduling`. El usuario eligió «Todo de una vez»: Ventas, Portal,
Notificaciones y Agenda, incluido el editor de horarios de atención y bloqueos
por profesional y sucursal.

## En alcance

- **Configuración › General** (`/app/settings/general`), en el menú de
  Configuración, con una sección por namespace. Cada sección se ve y se guarda
  solo con su permiso (`sales.settings.manage`, `portal.settings.manage`,
  `notifications.settings.manage`, `scheduling.settings.manage`) y solo si la
  clínica tiene el feature que el namespace requiera (`sales`, `portal`). El
  backend sigue siendo la autoridad.
- **Ventas:** «La factura exige cliente» (`requireCustomerForInvoice`). La
  moneda (`defaultCurrency`) se muestra sin edición: hoy solo se factura en PYG.
- **Portal:** «Las reservas necesitan aprobación» (`bookingRequiresApproval`).
- **Notificaciones:** horas de anticipación del recordatorio (rango de la API) y
  canales (al menos uno, sin repetir).
- **Agenda:** política de superposición (`REJECT`/`ALLOW`); horarios de atención
  (profesional, sucursal, día, hora de inicio y fin) y bloqueos (profesional,
  sucursal, desde, hasta). Profesionales y sucursales se eligen de listas.
- **Proxy:** `/api/settings/:namespace` acepta `GET` y `PUT` para los cuatro
  namespaces (hoy solo `scheduling`).
- Los errores de validación de la API se muestran en la sección.

## Fuera de alcance

- Cambiar la moneda, nuevos ajustes o namespaces, control de concurrencia entre
  dos editores simultáneos ([[TD-010]] sigue: la última escritura gana).

## Criterios de aceptación

- [ ] Cada sección muestra los valores actuales (o los defaults) y guarda solo
      lo que cambió.
- [ ] Sin el permiso de una sección, la sección no se ofrece; sin el feature, la
      sección no se ofrece.
- [ ] Horarios y bloqueos: alta, edición y baja; fin posterior al inicio; solo
      profesionales y sucursales de la clínica.
- [ ] El proxy acepta los cuatro namespaces y rechaza cualquier otro como antes.
- [ ] Prueba en navegador del recorrido.

## Avance

### T1 — Ventas, Portal, Notificaciones, política de Agenda y proxy (S1-S3, S5)

- Página `/app/settings/general`
  (`apps/web/src/app/(app)/app/settings/general/`) con una sección por
  namespace. Cada sección lee `GET /api/settings/<ns>`, guarda `PUT` con **solo
  las claves cambiadas** y se refresca desde la API; carga, error de lectura
  (con reintento), rechazo al guardar y éxito se muestran dentro de la sección.
  `VALIDATION_FAILED`, `FORBIDDEN` y `FEATURE_NOT_ENTITLED` muestran cada uno
  una frase en español; el mensaje en inglés de la API no se muestra (UX-036).
- Ventas: «La factura exige cliente»; la moneda se ve como campo de solo
  lectura. Portal: «Las reservas necesitan aprobación». Notificaciones: horas de
  anticipación (1 a 168, entero) y canales (correo, WhatsApp; al menos uno, sin
  repetir, en el orden de la API). Agenda: solo la política de superposición; su
  guardado nunca envía `availability` ni `blocks`.
- Los límites y canales del recordatorio se replican en la web (no puede
  importar `@newsaas/notifications`); un test lee el código fuente del paquete y
  falla si divergen.
- Menú: «General» en Configuración, visible con cualquiera de los cuatro
  permisos (`requiredAnyPermission`, nuevo y opcional en `NavLink`).
- Proxy: la allowlist pasa a `sales`, `scheduling`, `portal`, `notifications`;
  namespaces desconocidos siguen en 404 sin llamada a la API, segmentos extra en
  404, `%` en 400, solo `GET`/`PUT`. La agenda sigue leyendo `scheduling` igual.
- Extensión para T2: `scheduling-section.tsx` marca dónde se monta el editor de
  horarios y bloqueos, con su propio guardado.

**Limitación:** la web todavía no conoce los permisos ni los features de quien
usa la pantalla (el proxy de memberships rechaza `me/permissions` a propósito y
no hay ruta de staff que devuelva los features). La superficie y el menú ya
filtran cuando reciben esas listas, pero la página no las pasa: hoy se ven las
cuatro secciones y la API rechaza el guardado sin permiso o sin feature, con el
mensaje en la sección. Hasta resolverlo, el criterio «sin el permiso o sin el
feature, la sección no se ofrece» se cumple en el componente, no en la app.

Criterios que T1 cree cumplidos (sin marcar hasta T3):

- «Cada sección muestra los valores actuales y guarda solo lo que cambió»: para
  Ventas, Portal, Notificaciones y la política de Agenda
  (`general-settings-surface.test.tsx`).
- «El proxy acepta los cuatro namespaces y rechaza cualquier otro como antes»
  (`apps/web/src/app/api/settings/[[...path]]/route.test.ts`).

## Verificación

Pendiente (T3).

## Limitación conocida: permisos y features en la web

La web todavía no conoce los permisos de quien entra ni los features de la
clínica: el proxy de memberships rechaza `me/permissions` por diseño y ninguna
ruta del staff devuelve los features. Por eso, igual que Importaciones e
Informes, la pantalla y el menú aceptan esas listas pero hoy no las reciben: se
ven las cuatro secciones y la API rechaza el guardado sin permiso o sin feature,
con su frase en español. El criterio «sin el permiso o el feature la sección no
se ofrece» está probado en los componentes, no en la app en vivo; queda abierto
hasta que la web cargue los permisos (decisión aparte).
