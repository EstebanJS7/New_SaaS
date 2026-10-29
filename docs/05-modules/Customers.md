---
type: module
module: customers
status: active
updated: 2026-10-29
---

# Module — Customers (Core)

## Responsibility

Tenant-scoped customer directory shared by all verticals. Stores individuals and
companies, their addresses and contact channels. The Veterinary Patients domain
owns guardian links to these Core customers; Customers does not import it.

## Does Not Own

- Veterinary clinical records, vaccinations, or treatments.
- Portal self-registration.
- Sales, billing, or fiscal behavior.
- Patient management and guardian commands (owned by [[Patients]]).

## Main Concepts

```text
Customer
CustomerAddress
CustomerContact
```

## Customer Kind

```text
INDIVIDUAL — firstName, lastName, documentNumber
COMPANY    — legalName, taxId
```

Both kinds share `displayName`, tenant scope, addresses, and contacts. The API
rejects kind-mismatched fields.

## Permissions

```text
customers.read
customers.create
customers.update
customers.deactivate
customers.address.manage
customers.contact.manage
```

Reference-seed role matrix:

| Role              | Permissions                                          |
| ----------------- | ---------------------------------------------------- |
| OWNER             | all six                                              |
| ADMIN             | all six                                              |
| RECEPTIONIST      | read, create, update, address.manage, contact.manage |
| VETERINARIAN      | read only                                            |
| CASHIER           | none                                                 |
| INVENTORY_MANAGER | none                                                 |

## API

```text
GET    /customers
POST   /customers/search
POST   /customers
GET    /customers/:id
PUT    /customers/:id
POST   /customers/:id/deactivate

GET    /customers/:customerId/addresses
POST   /customers/:customerId/addresses
GET    /customers/:customerId/addresses/:id
PUT    /customers/:customerId/addresses/:id
POST   /customers/:customerId/addresses/:id/deactivate

GET    /customers/:customerId/contacts
POST   /customers/:customerId/contacts
GET    /customers/:customerId/contacts/:id
PUT    /customers/:customerId/contacts/:id
POST   /customers/:customerId/contacts/:id/deactivate
```

Web proxy route:

```text
/api/customers/[[...path]]
```

## Data Classification

`displayName`, `legalName`, `taxId`, `firstName`, `lastName`, and
`documentNumber` are **CONFIDENTIAL**. Logs and audit metadata carry IDs and
field names only; values are never logged.

## Invariants

- Every customer, address, and contact row is tenant-scoped.
- Database lookups filter by `id` **and** server-derived `tenantId` (and
  `customerId` for children); cross-tenant UUID access returns `404`
  byte-equivalent to a nonexistent ID.
- Default `GET /customers` returns active rows only.
- Deactivate is a soft-delete command (`isActive = false`), idempotent, and
  audited.
- There is no hard-delete endpoint.
- Audit co-commits one `audit_log` row per mutation inside the same transaction.
- Audit metadata contains only `schemaVersion`, `changedFields`, and stable IDs;
  no free-text reasons or CONFIDENTIAL values are logged.
- The customer directory does not read clinical data or traverse guardian links.
  The Veterinary Patients domain owns those links (UX-003/UX-008).

## Implementation

- `packages/database/prisma/schema.prisma` — models, enums, indexes.
- `packages/database/prisma/migrations/20260826150100_customers/migration.sql` —
  additive CREATE TABLE statements.
- `apps/api/src/customers/*` — service, controllers, Zod schemas, DTOs, tests.
- `apps/web/src/app/(app)/app/customers/*` — staff list, detail, create, edit
  UI.
- `apps/web/src/app/api/customers/[[...path]]/route.ts` — Next.js proxy.

## Known limitations / blockers

- Historical Customer CRUD/navigation browser coverage was deferred under
  [[TD-007]]. The repository now has `apps/e2e/playwright.config.ts`; UX-010 did
  not run or certify that lane. Its new search flow has automated component,
  HTTP/proxy and PostgreSQL evidence, not a new browser review.
- Live application-path HTTP tenant isolation has been executed against a real
  PostgreSQL database in CI. GitHub Actions run
  [`34605178149`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34605178149)
  for commit `c9cff6131b6036849d0899a5735e6a2a6a3be5fd` reported the live-PG
  suite `apps/api/test/live-pg-isolation.e2e-spec.ts` as 6/6 passed. The harness
  boots the real `AppModule` with the real `PrismaService` against a disposable
  PostgreSQL database, applies migrations and reference seeds, creates the
  fixture tenants, users, and memberships directly through `PrismaService`, and
  uses Supertest over an explicitly bound NestJS/Fastify listener to prove
  byte-equivalent `404 NOT_FOUND` for cross-tenant Customer/Address/Contact
  mutations. The suite is skipped automatically when
  `DATABASE_URL_TEST`/`DATABASE_URL` are absent. The broader Batch 5 isolation
  suite remains tracked under [[TD-006]].

## Related

- [[Data Classification and Retention]]
- [[Reversals and Corrections]]
- [[Audit and Entitlements]]
- [[TD-006]]

## Búsqueda y paginación del listado — UX-010

`POST /customers/search` es una lectura aditiva con HTTP 200 y permiso
`customers.read`, autenticación staff y membresía activa. El servicio reafirma
el permiso y resuelve el tenant del contexto; el cliente no puede enviarlo como
autoridad. Customers sigue siendo Core sin entitlement adicional.

Cuerpo estricto: `q` (vacío o 2–80 caracteres, trim), `page` (entero 1–10000),
`status` (`active`, `inactive`, `all`), `kind` (`all`, `INDIVIDUAL`, `COMPANY`),
`sort` (`name`, `recent`). Defaults: vacío, 1, activos, todos los tipos, nombre.
La búsqueda parcial sin distinguir mayúsculas conserva los cuatro campos del
listado anterior: displayName, legalName, documentNumber y taxId. No busca
contactos, direcciones, datos clínicos ni campos fiscales nuevos.

Conteo y filas usan el mismo predicado tenant/filtros en una transacción
RepeatableRead. Tamaño fijo 20; displayName ascendente o createdAt descendente,
siempre con UUID ascendente de desempate. Una página sin rango se ajusta a la
última disponible (1 cuando no hay resultados). Respuesta: items, page,
pageSize, total y totalPages. Cada fila permite únicamente id, displayName,
kind, isActive, firstName, lastName y legalName. No proyecta documentos/RUC,
contactos, direcciones ni campos fiscales. GET /customers conserva su array de
activos y DTO; los comandos y paquetes compartidos (DEC-073) no cambian.

La ruta web existente `/app/customers` usa el nuevo contrato. Sus textos están
en español, con conteos es-PY y tokens semánticos. Tiene búsqueda explícita,
estado, tipo, orden, paginación, carga, vacío, errores y reintento. Se conserva
la confirmación existente de desactivación; filtrar/paginar/navegar solo lee. El
detalle agrega **Volver al listado de clientes**. El contexto aplicado se
conserva diez minutos en memoria del mismo documento al abrir y volver.

El BFF específico `/api/customers/search` admite únicamente POST, cookie staff y
claves del contrato, mantiene el cuerpo exacto y responde private, no-store.
Rechaza texto de búsqueda en query y autoridad tenant. El proxy CRUD anterior
queda intacto. Búsqueda y nombres/documentos son CONFIDENTIAL: no se loguean
cuerpos/resultados, no se ponen datos personales en URLs ni se usa
localStorage/sessionStorage o persistencia del QueryClient. Recarga/reingreso
elimina el contexto. No se agregan columnas, migraciones ni permisos.

Límites: offset no congela resultados entre peticiones, sin búsqueda fonética,
sin normalización especial de acentos o formato de documentos; hasta 10000
páginas como UX-008. La traducción alcanza el listado, su confirmación y el
enlace de retorno; no implica que detalle/formularios/Portal estén traducidos.
Sin nueva revisión visual, Back/Forward real, lector de pantalla o auditoría
WCAG en esta etapa. Pruebas y límites separados en
[[UX-010-customer-search-pagination]] y [[UX-010-VALIDATION-2026-10-29]].
