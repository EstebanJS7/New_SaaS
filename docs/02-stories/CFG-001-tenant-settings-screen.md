---
id: CFG-001
type: story
title: Tenant settings screen (sales, portal, notifications, scheduling)
epic: EPIC-20
status: done
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

- [x] Cada sección muestra los valores actuales (o los defaults) y guarda solo
      lo que cambió.
- [x] Sin el permiso de una sección, la sección no se ofrece; sin el feature, la
      sección no se ofrece.
- [x] Horarios y bloqueos: alta, edición y baja; fin posterior al inicio; solo
      profesionales y sucursales de la clínica.
- [x] El proxy acepta los cuatro namespaces y rechaza cualquier otro como antes.
- [x] Prueba en navegador del recorrido.

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

### T2 — Horarios de atención y bloqueos (S4)

- En la sección Agenda, debajo de la política de superposición, el editor
  «Horarios de atención» (profesional, sucursal, día, desde, hasta) y «Bloqueos»
  (profesional, sucursal, desde, hasta con fecha y hora). Alta, edición y baja
  por fila; «Guardar horarios y bloqueos» envía solo la lista que cambió,
  completa (la API reemplaza los arreglos enteros); nunca envía
  `conflictPolicy`, y el guardado de la política nunca envía las listas.
- Semántica tomada del código de la API
  (`apps/api/src/scheduling/appointment-invariants.ts`): `weekday` 0 es domingo;
  los minutos son hora local de la clínica (`America/Asuncion`); un fin `00:00`
  se guarda como 1440 (medianoche al final del día). Los bloqueos se ingresan y
  muestran en hora de la clínica y se envían como instantes UTC con los mismos
  helpers de la agenda (`agenda-time.ts`).
- Validación en la web igual a la de la API: profesional y sucursal
  obligatorios, fin posterior al inicio, horas válidas; los mensajes son en
  español. El rechazo de la API usa la misma frase en español que T1.
- Profesionales y sucursales salen de `GET /appointments/options`
  (`scheduling.appointment.read`, que tienen los roles con
  `scheduling.settings.manage`): veterinarios y sucursales de esta clínica, por
  nombre. Una fila con un profesional o sucursal que ya no figura se ve como
  «Profesional no disponible» / «Sucursal no disponible» y se puede editar o
  quitar; nunca se descarta en silencio.
- Si las listas guardadas no se pueden leer o falla la carga de profesionales y
  sucursales, el editor no ofrece edición (con reintento en el segundo caso).
- Tests: `availability-editor.test.tsx` (14).

**Limitación:** guardar la política de superposición refresca la sección y
descarta cambios sin guardar del editor de horarios (y viceversa); cada
formulario se guarda por separado.

## Verificación

- **T1:** web 2431 tests en verde; typecheck, lint y prettier en verde; parent
  rerun focalizado 83/83 tras la corrección del mensaje en español (UX-036).
- **T2:** 14 tests nuevos RED→GREEN (`availability-editor.test.tsx`); web 2445
  en verde; typecheck, lint y prettier en verde; parent rerun de settings 43/43.
- **T3 — navegador** (`apps/e2e/specs/tenant-settings.spec.ts`, apps construidas
  con `pnpm build`, navegador en `America/Los_Angeles`): el dueño demo entra por
  «Configuración › General» y, por la pantalla real:
  - Ventas: cambia «La factura exige cliente», guarda, recarga y sigue cambiado;
    `GET /api/settings/sales` coincide; la moneda se ve `readonly` con el valor
    de la API.
  - Portal: cambia «Las reservas necesitan aprobación» y persiste (pantalla y
    API).
  - Notificaciones: 169 horas se rechaza en la página con su mensaje y **sin
    ningún `PUT`**; horas válidas distintas por corrida y WhatsApp alternado
    persisten con un único `PUT`.
  - Agenda: la política de superposición persiste y la API conserva las listas.
    Un horario (profesional y sucursal de los selectores, día y `HH:MM` al azar)
    y un bloqueo (diciembre, hora local) se guardan; tras recargar se ven con
    los mismos valores locales y la API guarda `weekday`/minutos locales y los
    instantes UTC esperados (local + 3 h). Se edita el fin del horario y se
    quita el bloqueo en un solo guardado; persiste.
  - Restauración: antes de cambiar nada lee los cuatro namespaces por el BFF y
    en un `finally` los escribe enteros y comprueba que la lectura es igual. La
    base quedó idéntica tras cada corrida (`tenant_setting_namespace` comparada
    antes/después). Como no hay `DELETE` de namespace, el tenant demo, que no
    tenía filas, queda con filas que guardan exactamente los defaults que ya se
    le servían.
- **Corridas:** la spec sola dos veces (2/2 en verde); de nuevo sola y enseguida
  las sensibles a estos ajustes (`branches`, `reports`, `portal-sign-in`,
  `payment-detail`, `sale-reversal`, `electronic-credit-note`): 9/9 en verde;
  lane completa una vez: **35/35 en verde**. `@newsaas/e2e` typecheck y lint en
  verde; prettier en verde en los archivos tocados.
- No hay en la lane una spec de reservas del portal ni de recordatorios; esos
  consumidores se cubren solo con la restauración exacta.
- Criterio de permisos/feature, en vivo ([[UX-037]] carga los permisos y
  features en la web):
  - Sin ninguna clave: `apps/e2e/specs/capabilities.spec.ts` — una veterinaria
    no ve «General» en el menú y la pantalla muestra «No tenés permiso para
    cambiar la configuración general» sin ninguna sección; el dueño ve las
    cuatro.
  - Con una sola clave: `apps/e2e/specs/capabilities-settings.spec.ts` — el
    dueño demo da al rol `RECEPTIONIST` su conjunto original más
    `scheduling.settings.manage` (`PUT /rbac/roles/:code/permissions`, directo a
    la API con la cookie de sesión). Una recepcionista invitada en la corrida
    tiene esa clave y ninguna otra de configuración; ve «General» en el menú y
    la pantalla ofrece solo «Agenda» (ni Ventas, ni Portal, ni Notificaciones);
    guarda la política de superposición y la API la devuelve cambiada. En
    `finally`: el rol vuelve a su conjunto original y `GET /rbac/roles` completo
    es igual a la foto previa (en la base no queda ninguna fila
    `tenant_role_permission_override`); `scheduling` se reescribe entero y se
    compara; la recepcionista queda suspendida.
  - Sin feature: la misma spec crea en cada corrida una segunda clínica con el
    comando de alta (`pnpm --filter @newsaas/database db:provision-tenant`, slug
    y email por corrida) con todos los features salvo `sales` y `portal`; la
    dueña activa su cuenta con el enlace que imprime el comando, en la página
    real. Sus capacidades tienen las cuatro claves y `sales.read`/`sales.create`
    pero no esos features; «General» ofrece solo Notificaciones y Agenda y el
    menú no tiene «POS».
  - Corridas: la spec sola dos veces (2/2 y 2/2 en verde); la lane completa una
    vez: **38/38 en verde**.

## Limitación conocida: permisos y features en la web

Resuelta por [[UX-037]]: el layout del staff carga los permisos y features de
quien entra, «General» y el menú los reciben, y los tres casos (sin clave, con
una sola clave, sin feature) están probados en el navegador (ver
«Verificación»).
