---
type: architecture
status: active
updated: 2026-08-13
---

# Internal Events

## Purpose

Provide a minimal mechanism for decoupled reactions inside the modular monolith
without turning transactional business logic into
asynchronous/eventual-consistency workflows.

## Non-goal

This is **not** event sourcing and **not** a distributed event platform.

The MVP does not require Kafka, NATS, RabbitMQ or a new broker.

## Principle

Transactional invariants remain explicit and synchronous.

Example:

```text
CompleteSale
  ↓
DB transaction
  ├── validate sale
  ├── validate payments
  ├── validate stock
  ├── create StockMovement
  ├── update StockBalance
  ├── create CashMovement when required
  └── mark Sale COMPLETED
  ↓
COMMIT
  ↓
SaleCompleted
```

Only after commit may decoupled subscribers react.

## Initial event catalog

Use only when a concrete subscriber exists:

```text
AppointmentConfirmed
AppointmentCancelled
ClinicalEncounterClosed
SaleCompleted
InvoiceConfirmed
FiscalApproved
FiscalRejected
```

Do not create unused events "for future flexibility".

## Event envelope

Recommended shape:

```ts
interface ApplicationEvent<TType extends string, TPayload> {
  id: string;
  type: TType;
  occurredAt: string;
  tenantId: string;
  aggregateId: string;
  payload: TPayload;
}
```

Payload rules:

- minimal;
- stable IDs;
- no private aggregate dumps;
- no secrets;
- avoid clinical free text/PII unless strictly required.

## Delivery

Default mechanism:

```text
in-process post-commit dispatcher
```

Use BullMQ when reaction requires:

- external network call;
- retry;
- delayed execution;
- durable asynchronous processing.

Do not invent a second queue system.

## Handler rules

Handlers must:

- be independently testable;
- be tenant-aware;
- be idempotent when execution may retry;
- never silently mutate the originating aggregate in a way that should have been
  inside its transaction.

## Failure semantics

Failure of a post-commit notification/analytics handler does not roll back the
already committed sale/appointment/etc.

Persist/retry only handlers whose business requirement requires durable
execution.

## Architecture gate

A generic cross-domain event bus abstraction used broadly across the platform
requires an ADR under the Complexity Budget.
