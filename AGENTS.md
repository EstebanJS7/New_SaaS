# Veterinary SaaS — Agent Rules

This repository is a multi-tenant SaaS with a reusable business Core and a
Veterinary vertical.

## Mandatory context loading

Before changing code:

1. Read `docs/99-governance/ENGINEERING-RULES.md`.
2. Read `docs/99-governance/DOCUMENTATION-RULES.md`.
3. Identify the active Epic/Story.
4. Read only the relevant PRD sections, Story, ADRs and module documentation.
5. Inspect the existing code before proposing implementation.

Do not load the entire vault when it is not relevant.

## Source-of-truth hierarchy

1. Implemented code, migrations and passing tests describe current behavior.
2. `docs/00-product/PRD.md` defines approved product scope and architectural
   intent.
3. Accepted ADRs define architectural decisions.
4. Story files define implementation scope for a specific task.
5. Module docs describe the implemented public behavior of each domain.

A Story, bug or technical-debt item MUST NOT silently modify the PRD.

## Architecture

Preserve:

- SaaS multi-tenancy.
- Modular monolith.
- Reusable Core Business domains.
- Separate Veterinary vertical.
- Next.js + React + TypeScript + Tailwind + shadcn/ui.
- NestJS + Fastify + Prisma + PostgreSQL.
- Redis + BullMQ for asynchronous work.
- Fiscal provider boundary.
- Ledger-based Inventory.
- Ledger-based Cash.
- Strict backend authorization.
- Auditability for critical operations.

Never introduce microservices, event sourcing, generic EAV entities or a
low-code entity engine unless an accepted ADR explicitly supersedes this rule.

## Branding and theming

The UI is product/tenant brandable.

Never hardcode a Veterinary-specific brand color, logo, radius, font or visual
identity inside reusable UI components.

Brand resolution order:

```text
TenantBranding overrides
→ ProductBrandPreset
→ CoreDesignDefaults
```

Rules:

- reusable components consume semantic design tokens;
- shadcn/Tailwind components must use CSS variables/tokens instead of literal
  brand colors;
- no arbitrary tenant CSS or JavaScript injection;
- tenant theme values are validated against a strict schema;
- fonts come from an approved allowlist or product bundle, not arbitrary remote
  CSS;
- logos/favicons are uploaded as controlled branding assets;
- staff and portal share the same resolved brand unless explicitly configured
  otherwise;
- custom branding is a reusable Platform/Core capability, never a Veterinary
  module;
- white-label/custom branding may be gated by Entitlements;
- a new product/vertical should be able to provide a different
  `ProductBrandPreset` without modifying shared components.

See `docs/03-architecture/BRANDING-THEMING.md` and
`docs/04-adrs/ADR-002-branding-theme-layering.md`.

## Internal application events

Use internal application/domain events only for decoupled post-commit reactions.

Examples:

```text
SaleCompleted
AppointmentConfirmed
InvoiceConfirmed
FiscalApproved
ClinicalEncounterClosed
```

Rules:

- events do NOT replace database transactions or explicit orchestration for
  transactional invariants;
- Sale completion must still update stock/cash atomically through explicit
  application services;
- events are emitted only after the authoritative transaction commits when the
  subscriber does not need to participate in that transaction;
- event payloads contain stable IDs and minimal metadata, not full sensitive
  aggregates;
- handlers must be idempotent when retries are possible;
- do not introduce Kafka, RabbitMQ, NATS or a generic distributed event bus
  without an accepted ADR;
- start with an in-process application event dispatcher and/or existing BullMQ
  jobs only where a concrete use case requires it.

See `docs/03-architecture/INTERNAL-EVENTS.md`.

## Tenant settings

Tenant behavior must be configured through a typed `TenantSettingsService`.

Never scatter arbitrary `settings` JSON reads throughout modules.

Rules:

- settings are namespaced;
- each namespace has a schema, defaults and schema version;
- all writes are validated server-side;
- modules consume typed settings through the service;
- unknown keys are rejected;
- secrets never live in tenant settings;
- Branding remains its own capability and is not duplicated into general
  settings.

See `docs/03-architecture/TENANT-SETTINGS.md`.

## Reversals and corrections

For completed/confirmed financial and inventory operations, correction is an
explicit business operation, not silent editing.

Rules:

- immutable confirmed movements remain immutable;
- reversals create compensating records and preserve links to the original
  operation;
- a reversal is idempotent;
- reversal reason and actor are audited;
- fiscal cancellation/event behavior is delegated to the Fiscal domain/provider;
- never implement a generic "delete transaction" feature.

See `docs/03-architecture/REVERSALS-CORRECTIONS.md`.

## Data classification and retention

Every new field containing personal, clinical, fiscal or secret material must be
classified.

Use these levels:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
```

Do not log CONFIDENTIAL/RESTRICTED payloads by default.

Do not implement automatic destructive retention for clinical/fiscal/audit
records until an explicit approved retention policy exists.

See `docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md`.

## Domain boundaries

Core domains must not import Veterinary implementation details.

Examples:

- `Inventory` does not know what a pet is.
- `Billing` does not call a concrete SIFEN/third-party client.
- `Cash` does not calculate invoice taxes.
- `Scheduling` does not manipulate clinical records.
- Veterinary may orchestrate capabilities exposed by Core domains.

## Multi-tenancy

Every private resource is tenant-scoped.

Never trust `tenantId` from request body, query or route as authority.

Resolve tenant context from the authenticated server-side request context.

Cross-tenant access to a resource UUID must return `404`.

Write tenant-isolation tests for every new private aggregate.

## Authorization

Frontend permission checks are UX only.

Every protected backend operation must validate:

- authentication;
- tenant membership or portal access;
- permission/policy;
- resource tenant/ownership context.

Portal identities must never gain staff access by sharing controllers or weak
role checks.

## Financial and stock invariants

Never:

- mutate stock balances directly;
- edit/delete confirmed stock movements;
- mutate cash balances directly;
- edit/delete confirmed cash movements;
- complete a Sale twice;
- confirm an Invoice twice;
- receive a Purchase twice;
- emit the same fiscal document twice.

Use explicit commands/transitions, database transactions and idempotency where
defined by the PRD.

Use Decimal/NUMERIC for money and quantities requiring precision.

## Clinical invariants

Closed clinical encounters are immutable by default.

Amendments require:

- explicit permission;
- an explicit amendment operation;
- an audit record;
- preservation of the previous state.

Never expose `internalNotes` in the customer portal.

## Fiscal

Billing must depend only on the Fiscal application boundary, never on a concrete
provider.

Do not implement SIFEN Direct from assumptions. Before that implementation,
revalidate current official DNIT technical documentation, XSDs and Notas
Técnicas.

External fiscal calls must happen outside long-running database transactions.

## Documentation workflow

When starting a Story:

- set its `status` to `in-progress`;
- update `updated`;
- record the working branch if known;
- do not change acceptance criteria unless the user approves a scope change.

When finishing a Story:

- run required verification;
- update implementation summary;
- record migrations/endpoints/tests;
- record limitations;
- create Tech Debt items rather than hiding shortcuts;
- create a Decision/ADR proposal for architectural changes;
- only set `status: done` when all required acceptance criteria and verification
  gates pass.

Documentation changes belong in the same commit/PR as the code they describe
whenever practical.

## Scope control

If implementation reveals a missing requirement that changes product scope:

1. Do not silently implement it.
2. Create a proposal under `docs/07-decisions/`.
3. Explain context, options, impact and recommendation.
4. Continue only with the smallest compatible implementation that does not alter
   approved scope, or stop that affected part if no safe compatible path exists.

## Code standards

- TypeScript strict.
- Avoid `any`; validate `unknown`.
- Prefer explicit code over generic base repositories/controllers.
- Business logic belongs in services/domain/application layers, not controllers.
- Repository/data-access code must be tenant safe.
- Never return Prisma models directly from public APIs.
- Validate all external input.
- Use stable domain error codes.
- Avoid new dependencies unless they solve a concrete requirement.
- Keep functions/modules small and predictable for humans and coding agents.
- Use semantic design tokens; never style reusable components with
  project-specific brand literals.

## Complexity budget

The MVP architecture is frozen unless an accepted ADR explicitly changes it.

An ADR is required BEFORE introducing any of the following:

- a new runtime/deployable service;
- a new database technology;
- a new queue/broker technology;
- a new ORM;
- a new authentication provider/strategy;
- a new frontend global state-management library;
- GraphQL or another API protocol beside the approved REST API;
- WebSocket infrastructure used as a general platform capability;
- a generic framework/abstraction consumed by 3+ domains;
- a cross-domain event-bus abstraction beyond the minimal internal event
  mechanism;
- a replacement for shadcn/Tailwind as the shared design-system foundation;
- a second CSS framework;
- micro-frontends;
- an additional cache/data store beyond approved PostgreSQL/Redis without
  measured need.

The agent must first prove a concrete requirement that cannot be met cleanly
with the current stack.

"Cleaner", "more scalable" or "industry standard" alone are not sufficient
reasons.

Prefer deleting an unnecessary abstraction over adding another one.

## Verification

Before declaring implementation complete, run the applicable project commands
for:

- lint;
- typecheck;
- unit tests;
- integration tests;
- build;
- critical E2E tests when the Story requires them.

Never mark a Story Done while required checks are failing.

## Git

Do not push without explicit user instruction/approval.

Do not rewrite shared history.

Prefer small coherent commits containing code, tests and the relevant
documentation update.

Suggested commit style:

```text
feat(VET-004): implement clinical encounters
test(VET-004): add tenant isolation coverage
docs(VET-004): record implementation details
```

## OpenCode commands

Use project commands in `.opencode/commands/`:

- `/story-start <ID>`
- `/story-finish <ID>`
- `/verify`
- `/decision <title>`
- `/docs-sync`

These commands do not replace judgment; they enforce the project workflow.
