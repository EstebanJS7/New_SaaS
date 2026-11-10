---
id: UX-037
type: story
title: The staff web knows the caller's permissions and the clinic's features
epic: EPIC-20
status: done
priority: high
depends_on: [CFG-001]
prd_sections: []
permissions: []
branch: feat/web-capabilities
created: 2026-11-10
updated: 2026-11-10
---

# UX-037 — Permisos y features en la web del staff

## Objetivo y autorización

El usuario: «lo de lo permisos es algo que debemos de agregar para que sea lo
más funcional posible». Hoy la web no conoce los permisos de quien entra ni los
features de la clínica: el menú y las pantallas que aceptan esas listas no las
reciben, así que muestran acciones que la API después rechaza.

## En alcance

- **API:** `GET /memberships/me/capabilities` (solo autenticado, con membresía
  activa): `{ permissions: string[], features: string[] }` de la clínica y la
  persona de la sesión. Nada de otra clínica ni de otra persona.
- **Web:** el layout del staff carga las capacidades una vez por request (como
  ya carga la marca) y las comparte con toda la app. El menú y las pantallas que
  ya aceptan `permissions`/`entitlements` las reciben.
- **Pantallas:** las acciones que la persona no puede hacer no se ofrecen (o se
  ven deshabilitadas con el motivo), en todos los módulos del staff.
- Si la carga falla, la web se comporta como hoy (muestra todo); la API sigue
  siendo la autoridad y rechaza.

## Fuera de alcance

- Cambiar permisos o roles (pantalla de roles, aparte), el portal del cliente.

## Criterios de aceptación

- [x] La ruta devuelve solo los permisos y features propios; sin sesión `401`;
      sin membresía activa `403`.
- [x] El menú y las pantallas ocultan lo que la persona no puede usar.
- [x] Con la carga fallida, la web muestra todo y la API rechaza como hoy.
- [x] Prueba en navegador con un rol limitado.
- [x] CFG-001: «sin el permiso o el feature, la sección no se ofrece» en vivo.

## Implementación

### T1 — API

- `GET /memberships/me/capabilities` en `MembershipsController`, junto a
  `me/permissions` y con la misma declaración vacía (solo autenticado y
  membresía activa): `401` sin sesión, `403` con la membresía suspendida.
- `permissions`: el mismo `PermissionResolver` que `me/permissions`, ordenado.
  `features`: nuevo `EntitlementsService.listGranted(tenantId)` (mismas filas
  `tenant_entitlement` que `has()`, ordenado); el tenant sale solo del contexto
  del request. `has()` no cambia. `me/permissions` sigue igual.
- La ruta entra en el probe de rutas como «solo autenticado».
- Clasificación de la respuesta: INTERNAL.
- Pruebas: `me-capabilities.integration.test.ts` (cuerpo exacto; dos clínicas
  con features distintos y dos personas con roles distintos no se mezclan;
  `401`; `403` suspendida), `entitlements.service.test.ts` (`listGranted`).

### T2 — Web

- El proxy de membresías permite además solo `GET me/capabilities`;
  `me/permissions` y todo lo demás sigue rechazado.
- El layout del staff carga las capacidades una vez por request
  (`lib/load-capabilities.ts`, en paralelo con la marca, con la cookie de la
  sesión, timeout de 5 s, cuerpo validado sin casts). Cualquier falla (no-2xx,
  timeout, cuerpo inválido) es «desconocido»: la web muestra todo, como antes, y
  la API rechaza. Nunca se lee como «sin permisos».
- `CapabilitiesProvider` / `useCapabilities()` (`lib/capabilities.tsx`) las
  comparten. `WorkspaceShell` las pasa al menú (escritorio y móvil).
- Pantallas que ya filtraban y ahora reciben la lista (contenedor por ruta):
  Configuración › General (`GeneralSettingsScreen`, permisos y features), un
  informe (`ReportWorkspaceScreen`), Importaciones (`ImportsIndexScreen`), el
  detalle de una importación (`ImportsDetailScreen`) y el detalle del paciente
  (`PatientDetail` → atención clínica y registros clínicos, tratamientos,
  estudios, pesos).
- Sin gating nuevo en pantallas que no lo tenían (eso es T3).

## Verificación

- **T1/T2** (log L3 de `odd/tasks/web-capabilities.md`): API
  `me-capabilities.integration.test.ts` (cuerpo exacto, dos clínicas y dos roles
  sin mezclarse, `401` sin sesión, `403` con la membresía suspendida); web
  completa 2475 en verde, API completa 2147 en verde / 277 omitidos; rerun del
  parent API 32/32 y web 43/43. La carga fallida (no-2xx, timeout, cuerpo
  inválido) queda «desconocida» y muestra todo: `load-capabilities.test.ts` y
  `workspace-shell.test.tsx` (sin provider se ven todos los enlaces). Esa rama
  no se prueba en el navegador.
- **T3** (log L4): helper `canUse`/`useCan` RED 5 → GREEN 5; comercio 711 y
  atención/administración 932 tests focalizados en verde; seam del parent: web
  197 archivos / 2594 tests, typecheck, lint y prettier en verde.
- **T4 — navegador** (`apps/e2e/specs/capabilities.spec.ts`, apps construidas
  con `pnpm build`): el dueño demo invita por el BFF a una veterinaria NUEVA en
  cada corrida (rol `VETERINARIAN`), el enlace de activación sale por mail
  (worker + sink SMTP) y ella elige su contraseña en la página real
  (`support/team.ts`). Con su sesión:
  - `GET /api/memberships/me/capabilities` es igual a lo que la API devuelve en
    `GET /memberships/me/permissions` (leído directo de la API con solo la
    cookie de sesión); incluye `patients.create` y `catalog.read` y no incluye
    ninguna clave de configuración, `users.membership.manage`,
    `branches.manage`, `catalog.create` ni `customers.create`.
  - Menú: cada entrada sigue su permiso de lectura (o de gestión, en
    Configuración). La veterinaria no ve «General», «Personal», «Sucursales» ni
    «Configuración fiscal»; ve «Inicio», «Pacientes», «Catálogo», «POS»,
    «Importaciones» y «Marca».
  - Catálogo sin «Nuevo artículo»; Clientes sin «Nuevo cliente»; Pacientes
    ofrece «Nuevo paciente».
  - «Sucursales» y «Personal» muestran su estado «No tenés permiso…» (y la API
    responde `403` al directorio); «General» muestra «No tenés permiso para
    cambiar la configuración general» y ninguna sección.
  - El dueño, en la misma corrida: la API y la web coinciden; ve «General»,
    «Personal», «Sucursales», «Nuevo artículo», «Nuevo cliente», las sucursales
    sin estado de sin-permiso y las cuatro secciones de «General».
  - Un `finally` suspende a la veterinaria: la corrida no deja otra persona
    activa.
- **Corridas:** la spec sola dos veces (1/1 y 1/1 en verde); la lane completa
  una vez: **36/36 en verde** (ninguna spec existente se vio afectada por el
  gating). `@newsaas/e2e` typecheck y lint en verde; prettier en verde en los
  archivos tocados.

- **T5 — CFG-001 en vivo** (`apps/e2e/specs/capabilities-settings.spec.ts`,
  `support/rbac.ts`, `support/tenant.ts`): un rol `RECEPTIONIST` con su conjunto
  original más solo `scheduling.settings.manage` ve «General» con únicamente
  «Agenda» y la guarda; el rol se restaura exacto (`GET /rbac/roles` completo
  igual a la foto previa). Una segunda clínica creada con `db:provision-tenant`
  sin `sales` ni `portal`: «General» ofrece Notificaciones y Agenda, no Ventas
  ni Portal, y el menú no tiene «POS». Detalle y corridas en [[CFG-001]]
  «Verificación»: la spec sola 2/2 dos veces; lane completa **38/38 en verde**.

### Requisitos alineados con la API (advertencias del verificador, 2026-11-10)

- **Atajo al POS del panel** y **«Ir al punto de venta»** de una consulta
  cerrada: pedían solo `sales.create`; el mostrador necesita `sales.create` +
  `sales.complete` + feature `sales`. Ahora ambos usan el mismo requisito del
  mostrador (`SALE_ACTIONS.sell` de `sales/sale-capabilities.ts`, importado, sin
  copia), así que aparecen exactamente cuando el mostrador puede vender. RED 2
  (`dashboard.test.tsx`, `clinical-workspace.test.tsx`: `sales.create` sin
  `sales.complete`) → GREEN.
- **Solicitudes de turno:** el requisito propio ya era el de la API
  (`scheduling.appointment.manage`); la lectura que además se pide no es parte
  de ese requisito sino de la página: sin `scheduling.appointment.read` toda la
  agenda es el estado «No tenés permiso para ver la agenda», las solicitudes se
  muestran en el calendario y aprobar una elige sucursal y profesional de
  `GET /appointments/options` (lectura). Se mantiene así, documentado en el
  código, y dos pruebas lo fijan: con solo `manage` no se pide nada a la API;
  con `read` + `manage` (sin `transition`) se listan.

## Limitaciones

- Conocidas de T3: entrar por URL directa a `/new` y `/edit` en comercio solo se
  oculta en la entrada (la API responde `403` y el formulario lo explica); el
  selector de período del dashboard sigue visible.

### Menú por permiso (2026-11-10)

Tras T4, el menú pasó a ocultar cada módulo sin su permiso de lectura (agenda,
clientes, pacientes, catálogo, proveedores, compras, stock, ventas, caja,
facturación, fiscal, informes, notificaciones, importaciones) y cada pantalla de
Configuración sin su permiso de gestión (Personal `users.membership.manage`,
Sucursales `branches.manage`, Configuración fiscal `fiscal.profile.manage` o
`fiscal.signing_material.manage`). «Pacientes» exige además el feature
`veterinary`. «Inicio» y «Marca» quedan para todo miembro: su lectura no pide
permiso. Con permisos desconocidos no se oculta nada. Prueba: tabla por entrada
en `nav-sidebar.test.tsx` (RED 18 → GREEN); se actualizaron tres pruebas que
fijaban el menú anterior.
