---
id: FISC-003
type: story
title: Fiscal interface and fake provider
epic: EPIC-15
status: planned
priority: high
depends_on:
  - FISC-002
prd_sections:
  - "22"
  - "23"
  - "41"
permissions:
  - fiscal.invoice.issue
branch:
created: 2026-10-02
updated: 2026-10-02
---

# FISC-003 — Fiscal interface and fake provider

## Objective

Implement the Fiscal application interface and deterministic
`FakeFiscalProvider` without leaking provider-specific details into Billing.

## Context

PRD §22 says Billing imports a Fiscal application interface, never a concrete
provider. `docs/06-fiscal/SIFEN.md` fixes the provider sequence as
`FakeFiscalProvider → ThirdPartyFiscalProvider → SifenDirectFiscalProvider` and
forbids SIFEN Direct work from stale notes.

## In Scope

- Fiscal port/facade, DTOs and provider result/error taxonomy.
- Deterministic fake provider outcomes for tests/dev.
- Sanitization boundary for request/response snapshots.
- Boundary tests proving Billing does not import a concrete provider.

## Out of Scope

- Real third-party provider integration.
- SIFEN XML/signature/certificate implementation.
- BullMQ submission orchestration, except interfaces required for the next
  Story.

## Acceptance Criteria

- [ ] Fiscal provider interfaces and DTOs live in the Fiscal module/application
      boundary and are consumable without concrete provider imports.
- [ ] `FakeFiscalProvider` can deterministically produce approved, rejected and
      transient-error outcomes for tests/dev.
- [ ] Provider outcomes update only Fiscal-owned state through Fiscal services.
- [ ] Sanitization removes or rejects CONFIDENTIAL/RESTRICTED provider payload
      content before persistence/logging.
- [ ] Tests cover fake outcomes, sanitization and boundary import rules.
- [ ] No SIFEN protocol details are implemented or inferred from memory.

## Domain Invariants

- Concrete providers are hidden behind the Fiscal boundary.
- Fake provider behavior is deterministic and not a substitute for a real fiscal
  adapter.
- Provider errors are classified before retry decisions are made.

## API

### Added

```text
None unless accepted decisions place a provider test hook behind internal test-only boundaries.
```

### Changed

```text
None.
```

## Database

### Migration

```text
None expected beyond FISC-002.
```

### Models/Tables

- Uses `FiscalDocument`.

## UI

- None.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Planned unit tests for provider outcomes and sanitization.
- Planned import-boundary test.

## Known Limitations

- Fake provider is non-production only.

## Technical Debt

- None planned.

## Decisions / ADRs

- Depends on accepted [[DEC-048]] and [[DEC-050]].

## Files / Modules

- `apps/api/src/fiscal/*`
- `apps/api/src/billing/*` only for boundary consumption when accepted
- Tests under `apps/api/src/fiscal/`

## Completion Notes

_Status must remain non-done until all required gates pass._
