---
id: DEC-073
type: decision
title:
  The customer and patient create contracts move to packages so the worker can
  use them
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-19"
  - "EPIC-04"
  - "EPIC-05"
related_decisions:
  - "DEC-070"
  - "DEC-072"
related_stories:
  - "IMP-001A"
  - "IMP-002"
  - "IMP-003"
prd_change_required: false
---

# DEC-073 — Shared create contracts

## Context

[[DEC-072]] put the import pipeline in the worker. [[DEC-070]] made the patient
import call the existing create contract rather than invent a guardian path. And
[[IMP-002]] promised that the import carries **no second copy of any validation
rule**.

Three requirements, and the code as it stands cannot satisfy all three:

```text
apps/api/src/customers/customer.zod.ts      createCustomerBody, and the rules
apps/api/src/customers/customers.service.ts CustomersService.create
apps/api/src/patients/patient.zod.ts        createPatientBody, and the rules
apps/api/src/patients/patients.service.ts   PatientsService.create
```

**The worker cannot import from `apps/api`.** So either the pipeline leaves the
worker, or the rules move somewhere both can reach, or the rules get duplicated.

The repository already answers this shape three times: `packages/notifications`,
`packages/fiscal` and `packages/storage` hold domain logic that **both**
`apps/api` and `apps/worker` consume. Importing is the fourth case, not a new
pattern.

## Question

Where do the create contracts live so an import running in the worker validates
with the same rules the API enforces?

## Options

### Option A — Extract the create path to `packages/customers` and `packages/patients` (accepted)

The zod create schemas, the DTO mappers and the create function move into
packages; `apps/api` keeps its routes, permissions, controllers and service
class, whose `create` becomes a delegation.

The create path is small (about 35 lines for a customer and 60 for a patient)
and its dependencies are narrow: a Prisma client, an audit appender, the tenant
id, the actor id, and — for patients — a global-catalog check. Everything else
those services do (reads, updates, deactivation, addresses, contacts, guardian
management) stays in the API untouched.

To make that possible the extracted function takes `tenantId` and the audit
appender as PARAMETERS instead of reading them from `RequestContextService`,
which is an API-request concern the worker does not have. That is the one
behavioural shape change, and it is what makes the function callable from a
non-request context at all.

### Option B — The API runs its own queue consumer

No refactor, but two consumers in two apps, and the API would do background work
that the `worker` deployable exists to hold. It also raises a scaling question
the repo has never answered: how many API replicas run a consumer each?
Rejected.

### Option C — Revise DEC-072 and keep the pipeline in the API

Contradicts PRD §32's "large imports run asynchronously", and makes a partial
commit indistinguishable from a cut-off request. Rejected.

## Decision

Accepted by the maintainer on 2026-10-19.

**`packages/customers` and `packages/patients` are created**, each exporting the
create schema, the create function and the response mapper. `apps/api`'s
services delegate to them; the worker calls them directly.

**No ADR.** `AGENTS.md` requires one for a new runtime, database technology,
queue, ORM, auth strategy, protocol or design-system foundation. This adds none
of those: it moves existing code into packages that already exist as a pattern,
with no new dependency and no new deployable.

## Consequences

### Product

None. The API's behaviour, permissions and DTOs are unchanged.

### Architecture

`packages/customers` and `packages/patients` join `packages/notifications` and
`packages/fiscal`. The worker can now create a customer or a patient through the
same function the API uses, which is what makes [[DEC-070]]'s "the import is a
caller" literally true.

The extracted function takes `tenantId` explicitly. That is deliberate and worth
stating: in the API the tenant comes from request context and never from an
argument, while the worker must be handed one it resolved from the `import_job`
row. A function that is safe in both has to take it as input; what keeps the API
safe is that its service still resolves it from the context and never from the
caller.

### Database/API

None. No migration; the DTOs are the same shapes.

### Delivery

[[IMP-001A]] performs the extraction. The existing customer and patient suites
(about 2 500 lines of tests across both modules) are the safety net: they must
stay green without a single assertion changed, which is what distinguishes a
move from a rewrite.

## PRD Update

No PRD change.
