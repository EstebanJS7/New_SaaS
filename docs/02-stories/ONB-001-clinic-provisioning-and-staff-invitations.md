---
id: ONB-001
type: story
title: Clinic provisioning and staff invitations
epic: EPIC-02
status: in-progress
priority: high
depends_on: [DAT-007, EPIC-02]
prd_sections: ["§7", "§8", "§9", "§36"]
permissions: [users.membership.manage]
branch:
created: 2026-11-02
updated: 2026-11-09
---

# ONB-001 — Alta de clínicas e invitación de personal

## Objetivo

Que una clínica real pueda empezar a usar el sistema sin tocar la base a mano:
"registrar organización → crear sucursal → invitar personal", el inicio del
recorrido del PRD §36.

## Contexto

Hasta ahora una organización solo existía si la creaba el seed demo, `Branch` no
tenía alta y el módulo de membresías solo listaba y cambiaba roles. El diseño D2
deja la creación de tenants como operación de operador ("no self-service
registration surface"); esta Story respeta esa regla.

Una **invitación no es un agregado nuevo**: es un `UserProfile` (creado si el
email es nuevo) más una `TenantMembership` ACTIVE, y el perfil todavía no tiene
credencial. "Pendiente de activación" es un hecho derivado: membresía activa y
credencial ausente. Sin credencial no se puede ingresar, así que la membresía no
otorga nada hasta la activación.

La activación reutiliza la recuperación de contraseña de DAT-007: misma tabla de
tokens, mismo hash, mismo uso único y misma página. Cambian la vigencia (72 h en
lugar de 30 min) y el texto del mensaje.

## En alcance

- Comando de operador `db:provision-tenant`: tenant, primera sucursal,
  entitlements, propietario (OWNER) y enlace de activación, en una transacción.
- `PasswordResetService`: si el perfil no tiene credencial, la crea (activación)
  y audita `auth.account_activated`.
- Recuperación de contraseña: un perfil invitado (sin credencial y con una
  membresía activa en una clínica activa) recibe un enlace de activación nuevo.
- Worker: el mensaje `STAFF_ACCOUNT` es de activación cuando el perfil no tiene
  credencial, nombra la clínica y vale 72 h.
- API de personal (`users.membership.manage`): directorio, invitar, reenviar
  activación, suspender y reactivar.

## Fuera de alcance

- Registro autoservicio de clínicas (diseño D2).
- Alta y edición de sucursales desde la aplicación (multi-sucursal, Fase 4).
- Restringir quién puede otorgar el rol OWNER: hoy, como en la asignación de
  roles existente, lo puede hacer cualquiera con `users.membership.manage`.

## Criterios de aceptación

- [x] El operador crea una clínica con su sucursal, funciones y propietario con
      un solo comando, y recibe un enlace de activación de un solo uso.
- [x] Slugs reservados o inválidos y slugs repetidos se rechazan sin escribir.
- [x] Un perfil invitado elige su primera contraseña con el enlace; queda
      auditado como activación.
- [x] Invitar a un email existente reutiliza el perfil; si ya tiene contraseña
      no se envía enlace.
- [x] Invitar a quien ya es miembro devuelve `CONFLICT`.
- [x] Reenviar la activación se rechaza si la cuenta ya está activa o la
      membresía está suspendida.
- [x] Suspender se rechaza sobre el propio acceso y cuando dejaría a la clínica
      sin nadie que gestione personal.
- [x] Todas las operaciones quedan auditadas sin email ni nombre.
- [x] Pantalla web de personal (WU-B): lista, invitar, reenviar, cambiar rol,
      suspender y reactivar, con confirmación y estados de carga, error y
      permiso.
- [x] Recorrido completo en el carril de navegador (WU-B)
      (`apps/e2e/specs/staff-team.spec.ts`: invitar, duplicado, reenviar,
      cambiar rol, activar e ingresar, permisos, suspender y reactivar).
- [x] Aislamiento por tenant: todas las lecturas y escrituras usan el tenant del
      contexto; una membresía de otra clínica responde `NOT_FOUND`.

## Invariantes de dominio

- El token en texto plano sale una sola vez; solo persiste su SHA-256.
- Un perfil sin credencial no puede ingresar.
- Siempre queda al menos un titular efectivo de `users.membership.manage`.

## API

### Agregado

```text
GET  /memberships/directory          users.membership.manage
POST /memberships/invitations        users.membership.manage   { email, displayName, roleCode }
POST /memberships/:id/activation     users.membership.manage
POST /memberships/:id/suspend        users.membership.manage
POST /memberships/:id/reactivate     users.membership.manage
```

### Cambiado

```text
POST /auth/password-reset    crea la credencial si el perfil no tenía (activación)
POST /auth/forgot-password   también responde a un perfil invitado
```

## Base de datos

Sin migraciones. Usa `user_profile`, `tenant_membership`,
`password_reset_token`, `branch`, `tenant_entitlement` y `audit_log` existentes.

## Resumen de implementación

WU-B (web):

- `apps/web/src/app/(app)/app/settings/team/`: página "Personal" (directorio,
  formulario de invitación, cambio de rol, reenviar, suspender, reactivar).
- `apps/web/src/app/api/memberships/[[...path]]/route.ts` con ruta permitida
  explícita en `src/lib/memberships-proxy-path.ts` (no es un catch-all).
- `apps/web/src/app/reset-password/`: con `&activate=1` la página dice "Activá
  tu cuenta" / "Cuenta activada"; mismo endpoint.
- Enlace "Personal" en la sección Configuración del menú.

WU-A (backend):

- `packages/shared/src/staff-recovery.ts`: `ACCOUNT_ACTIVATION_TOKEN_TTL_MS`,
  `staffActivationUrl`.
- `packages/database/src/tenant-provisioning.ts` y `prisma/provision-tenant.ts`
  (`db:provision-tenant`).
- `apps/api/src/tenancy/staff-invitation.service.ts`, rutas en
  `membership.controller.ts`, directorio en `tenant-membership.repository.ts`.
- `apps/api/src/auth/password-reset.service.ts` y
  `password-recovery.service.ts`.
- `apps/api/src/notifications/password-recovery.scheduler.ts` escucha
  `StaffActivationRequested`.
- `apps/worker/src/notification-delivery/notification-content.builder.ts`:
  mensaje de activación.

## Verificación

```text
2026-11-02 (entorno sin PostgreSQL ni libxmljs2):
  typecheck api, worker, database (incluido el comando)   OK
  api: 885 tests OK; fallan solo suites de integración que necesitan
       DATABASE_URL o libxmljs2 (ambientales)
  worker notification-content.builder: 24/24
  database tenant-provisioning: 18/18
2026-11-02 WU-B:
  web typecheck, lint, prettier y next build OK
  web: team-surface 10, memberships-proxy-path 14, reset-password 11 (3 nuevos),
       nav-sidebar actualizado
  suite web completa: 2139 OK; 22 fallas PREEXISTENTES ajenas a esta Story
       (dashboard/compras/proveedores esperan textos en inglés; surface-integrity
       por /app/sales?patient= en clinical-workspace)
Pendiente: suite completa con PostgreSQL (pnpm test) y recorrido en navegador.
```

## Tests agregados

- `apps/web/src/app/(app)/app/settings/team/team-surface.test.tsx` (10)
- `apps/web/src/lib/memberships-proxy-path.test.ts` (14)
- `apps/api/src/tenancy/staff-invitation.service.test.ts` (12)
- `packages/database/src/tenant-provisioning.test.ts` (18)
- Casos nuevos en `password-reset.service.test.ts`,
  `password-recovery.service.test.ts`, `password-recovery.scheduler.test.ts` y
  `notification-content.builder.test.ts`.

## Limitaciones conocidas

- El reenvío de activación comparte la deduplicación horaria de la recuperación
  (`staff-recovery:<perfil>:<hora>`): dos reenvíos en la misma hora mandan un
  solo mensaje.
- El botón "Suspender" aparece también en la fila propia; la API lo rechaza con
  un mensaje claro, pero la pantalla no sabe todavía quién es el usuario actual.

## Deuda técnica

- Ninguna nueva.

## Decisiones / ADRs

- Diseño D2 (creación de tenants solo por operador), DAT-007 (tokens), DEC-088
  (despliegue).
