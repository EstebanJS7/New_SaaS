---
id: UX-037
type: story
title: The staff web knows the caller's permissions and the clinic's features
epic: EPIC-20
status: in-progress
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

- [ ] La ruta devuelve solo los permisos y features propios; sin sesión `401`;
      sin membresía activa `403`.
- [ ] El menú y las pantallas ocultan lo que la persona no puede usar.
- [ ] Con la carga fallida, la web muestra todo y la API rechaza como hoy.
- [ ] Prueba en navegador con un rol limitado.
- [ ] CFG-001: «sin el permiso o el feature, la sección no se ofrece» en vivo.

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

T1/T2: ver el log de la feature (`odd/tasks/web-capabilities.md`). Pendiente
T3/T4 (pantallas restantes y prueba en navegador con rol limitado).
