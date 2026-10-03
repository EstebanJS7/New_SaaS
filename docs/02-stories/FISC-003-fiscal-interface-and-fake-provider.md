---
id: FISC-003
type: story
title: Fiscal interface and fake provider
epic: EPIC-15
status: in-progress
priority: high
depends_on:
  - FISC-002
prd_sections:
  - "22"
  - "23"
  - "41"
permissions:
  - fiscal.invoice.issue
branch: feat/epic-15-fiscal-interface-and-fake
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

- The Fiscal provider port: `FISCAL_PROVIDER` symbol token, `FiscalProviderPort`
  interface, the request DTO built from the invoice's frozen snapshot, and the
  normalized outcome union with `isRetryableOutcome`.
- `FakeFiscalProvider` with a deterministic outcome script and reproducible
  external ids.
- `sanitizeProviderSnapshot`: allowlist, fail-closed, bounded, pure.
- `FiscalModule` wiring plus the `FISCAL_PROVIDER` env var and its production
  gate.
- Boundary tests proving no domain outside `fiscal/` imports a concrete
  provider.

The full binding contract — file names, DTO fields, outcome literals,
determinism rules, sanitization rules, the production gate and the explicit
non-goals — is pinned in
`odd/tasks/fisc-003-fiscal-interface-and-fake-provider.md` and reproduced in the
sections below.

## Out of Scope

- Real third-party provider integration.
- SIFEN XML/signature/certificate implementation; the fake produces no protocol
  artefact (PRD §23).
- BullMQ submission orchestration, the queue, the retry loop and the issue
  command ([[FISC-004]]).
- `cancel` on the port, which lands with the cancellation flow in [[FISC-005]].
- Any Fiscal service, repository, controller or route; `fiscal.invoice.issue`
  stays consumed by no route.
- Any database write or migration, and the fiscal storage prefix.

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

- Concrete providers are hidden behind the Fiscal boundary, and the concrete
  implementation module is imported by nothing outside `apps/api/src/fiscal/`.
- Fake provider behavior is deterministic and not a substitute for a real fiscal
  adapter.
- Provider errors are classified before retry decisions are made: exactly one
  outcome, `TRANSIENT_FAILURE`, is retryable.
- Money crosses the port as decimal strings, never as floating point numbers.
- No provider credential, certificate, PIN or secret material is accepted,
  stored or logged by the boundary.

## API

### Added

```text
None. This slice ships no route and no controller, so `fiscal.invoice.issue`
stays consumed by no route exactly as FISC-002 left it.
```

### Changed

```text
None.
```

### Provider boundary (internal, not HTTP)

```ts
FISCAL_PROVIDER: symbol token
FiscalProviderPort.issue(request: FiscalIssueRequest): Promise<FiscalIssueResult>
isRetryableOutcome(outcome: FiscalIssueOutcome): boolean
createFakeFiscalProvider(options?): FakeFiscalProvider
sanitizeProviderSnapshot(value, options?): { snapshot, redactedPaths }
```

Outcome literals: `APPROVED`, `REJECTED`, `FUNCTIONAL_REJECTION`,
`CONFIGURATION_ERROR`, `TRANSIENT_FAILURE`. The result is a discriminated union
rather than a thrown `DomainError`, because the Fiscal service must classify,
persist and decide retryability on it, and because the frozen `ERROR_CODES`
registry describes HTTP-mapped failures rather than provider outcomes.

### Configuration

```text
FISCAL_PROVIDER   optional   closed set: "fake"   (EPIC-16 adds "third_party")
```

`NODE_ENV=production` with `FISCAL_PROVIDER` unset is refused at boot through
the same `superRefine` gate the branding asset secret uses: there is no
production fiscal provider until [[EPIC-16]], and silently emitting non-fiscal
documents is worse than failing fast. Setting `FISCAL_PROVIDER=fake` explicitly
is the dedicated-demo path `docs/03-architecture/DEMO-TENANT.md` already
describes.

## Database

### Migration

```text
None. This slice writes nothing.
```

### Models/Tables

- Uses `FiscalDocument` as a type only; no row is created, read or updated here.
  The issue command that writes it is [[FISC-004]].

## UI

- None.

## Implementation Summary

Implemented the Fiscal application boundary: the provider port and its token,
the request/result DTOs, `isRetryableOutcome`, the deterministic
`FakeFiscalProvider`, the fail-closed `sanitizeProviderSnapshot`, the
`FiscalModule` composition root with its `FISCAL_PROVIDER` selection, and the
source-text boundary rule.

One correction to the pinned contract was needed during implementation: the
contract said the port would import the `FiscalProvider` enum from
`@newsaas/database`, but that package deliberately keeps `@prisma/client`
private and re-exports only the `Prisma` namespace, which does not expose the
enums. The port now declares its own frozen vocabulary (`FISCAL_PROVIDER_VALUES`
/ `FiscalProviderId`), mirroring how `billing.zod.ts` declares
`INVOICE_STATUS_VALUES`. That is also the better boundary: a port should not
depend on the persistence layer's generated types. Drift would surface as a type
error where a Fiscal service assigns a provider to `FiscalDocument.provider` in
[[FISC-004]].

The `FISCAL_PROVIDER` closed set is declared once, in `api-env.schema.ts` as
`FISCAL_PROVIDER_ENV_VALUES`, and the module factory validates against that same
constant rather than a second copy. The production refusal exists in both the
schema `superRefine` (authoritative, runs at boot in `main.ts`) and the factory
(defense in depth at the composition root, matching how `BrandingModule`
validates its own Redis requirement).

## Verification

```text
TDD: disabled by `openspec/config.yaml` (`strict_tdd: false`,
`rules.apply.tdd: false`); RED/GREEN lifecycle not active.

pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts \
  src/fiscal/ src/config/api-env.schema.test.ts
  -> 5 files / 60 tests passed
     (fiscal-boundary 4, api-env.schema 27, fiscal-snapshot.sanitizer 14,
      fake-fiscal.provider 10, fiscal-provider.port 5)
pnpm --filter @newsaas/api test (with DATABASE_URL_TEST exported)
  -> 81 files / 1232 tests passed, live-PostgreSQL spec included
pnpm --filter @newsaas/database test
  -> 19 files / 407 tests passed
pnpm typecheck / lint / build / format-check
  -> 14/14, 14/14, 9/9, clean
```

This slice has **no live-PostgreSQL gate of its own**: every fiscal test here is
a pure unit test that needs no database, so the failure mode that cost FISC-002
fifteen defects does not apply. The API suite above still runs the whole
live-PostgreSQL spec, unchanged at 176 cases.

## Tests Added

- `apps/api/src/fiscal/fake-fiscal.provider.test.ts` — the ordered script, the
  last-entry floor, reproducible external ids, the per-outcome shape rules, and
  the absence of any protocol artefact.
- `apps/api/src/fiscal/fiscal-snapshot.sanitizer.test.ts` — allowlisted keys
  survive, everything else is redacted with its dotted path recorded,
  secret-shaped keys are redacted inside allowlisted objects, depth and string
  bounds hold, arrays are indexed, and the input is never mutated.
- `apps/api/src/fiscal/fiscal-boundary.test.ts` — source-text walker asserting
  the concrete provider module is imported by nothing outside `fiscal/`, with
  the extractor self-tested against each import form.
- `apps/api/src/fiscal/fiscal-provider.port.test.ts` — `isRetryableOutcome`
  admits exactly `TRANSIENT_FAILURE`.
- `apps/api/src/config/api-env.schema.test.ts` — the `FISCAL_PROVIDER` closed
  set and the production refusal.

## Known Limitations

- Fake provider is non-production only, and in production it is refused at boot
  unless explicitly selected.
- No provider credential handling exists: `FiscalDocument` has no credential
  field and no secret reference is resolved, because the fake needs none.
- The fake produces no XML, KuDE or signature, so `xmlStorageKey` and
  `kudeStorageKey` stay null in EPIC-15 and no fiscal storage prefix is added.
  That lands with the first real artifact producer in [[EPIC-16]].
- `cancel` is absent from the port until [[FISC-005]] owns the flow that uses
  it; DEC-048's "issue/cancel capabilities" is satisfied across the epic rather
  than in this slice.
- No retry, backoff or idempotency behaviour ships here; the port only
  classifies outcomes for [[FISC-004]] to act on.

## Review record

The native review of this slice closed **approved and acknowledged** on lineage
`review-7b6f337b64ce340f` (revision
`sha256:1288115284326d4e0feae11052387d148578cd1fd3f20e0f41173650d6ca07aa`),
`risk_tier: medium`, one lens (`review-reliability`), no correction budget
consumed. Three advisories, and the substantive one was fixed rather than
recorded:

- `R3-fiscal-prod-gate-uncovered` (WARNING) — the composition root's production
  refusal had no test, because it lived inside a Nest factory where nothing
  would notice it regressing. The resolution was extracted into a pure exported
  `resolveFiscalProvider(nodeEnv, rawValue)` and covered by
  `fiscal.module.test.ts`: unset outside production resolves to `undefined`,
  `fake` is accepted in every environment, production with an unset value is
  refused, and a value outside the closed set is refused. The closed set itself
  is pinned so widening it must be a deliberate edit.
- `R3-fake-empty-outcomes` (SUGGESTION) — the fake already fell back to
  `APPROVED` for an empty script, so this was a coverage gap rather than a
  defect. `fake-fiscal.provider.test.ts` now pins that degenerate case.
- `R3-boundary-filter-fragile` (SUGGESTION) — the boundary test's specifier
  filter is a little indirect but correct: its extractor is self-tested against
  all four import forms, which is what keeps it from passing vacuously.
  Recorded, not actioned.

## Technical Debt

- None planned.

## Decisions / ADRs

- Depends on accepted [[DEC-048]], [[DEC-049]] and [[DEC-050]].
- [[DEC-048]] names four outcome classes loosely; this slice pins them onto
  [[DEC-049]]'s precise taxonomy, with `isRetryableOutcome` as the single
  retryability predicate.
- No ADR: the slice adds no runtime, queue, dependency or protocol.

## Files / Modules

- FISC-004 moved the provider port, fake, sanitizer and provider module into
  `packages/fiscal` so the worker deployable can consume the same boundary; the
  API keeps its own composition root.
- `apps/api/src/fiscal/fiscal-provider.port.ts`
- `apps/api/src/fiscal/fake-fiscal.provider.ts`
- `apps/api/src/fiscal/fiscal-snapshot.sanitizer.ts`
- `apps/api/src/fiscal/fiscal.module.ts`
- `apps/api/src/fiscal/fake-fiscal.provider.test.ts`
- `apps/api/src/fiscal/fiscal-snapshot.sanitizer.test.ts`
- `apps/api/src/fiscal/fiscal-boundary.test.ts`
- `apps/api/src/config/api-env.schema.ts` and its test
- `apps/api/src/app.module.ts`

## Completion Notes

_Status must remain non-done until all required gates pass._
