---
feature: fisc-003-fiscal-interface-and-fake-provider
epic: EPIC-15
story: FISC-003
status: in-progress
created: 2026-10-02
updated: 2026-10-02
branch: feat/epic-15-fiscal-interface-and-fake
base_commit: 83abe73
---

# FISC-003 Fiscal interface and fake provider — ODD task tracker

## Goal

Ship the Fiscal application boundary that the whole epic depends on: a provider
port with a normalized outcome taxonomy, a deterministic `FakeFiscalProvider`, a
fail-closed snapshot sanitizer, module wiring, and the source-text boundary test
that keeps concrete providers out of every other domain.

No API, no route, no worker, no queue, no database write. The issue command that
consumes this boundary is [[FISC-004]].

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.
- Consequence: no RED-first obligation. The gates are the focused unit suites,
  `typecheck`, `lint`, `format-check`, and the whole `pnpm test` run.
- Runner if it were active: `pnpm test` (Vitest).

## Pinned technical contract (decided by the parent, binding on the writer)

Derived from accepted DEC-048, DEC-049 and DEC-050, PRD §22/§23/§41,
`docs/06-fiscal/SIFEN.md`, and the shipped port precedents in this repository
(`packages/storage/src/storage.port.ts`, `branding-reset-cleanup.producer.ts`).

### Files

```text
apps/api/src/fiscal/fiscal-provider.port.ts        port, token, request/result DTOs, retryability
apps/api/src/fiscal/fake-fiscal.provider.ts        FakeFiscalProvider + createFakeFiscalProvider
apps/api/src/fiscal/fiscal-snapshot.sanitizer.ts   sanitizeProviderSnapshot (pure)
apps/api/src/fiscal/fiscal.module.ts               FiscalModule wiring
apps/api/src/fiscal/fake-fiscal.provider.test.ts
apps/api/src/fiscal/fiscal-snapshot.sanitizer.test.ts
apps/api/src/fiscal/fiscal-boundary.test.ts        source-text boundary rule
```

Plus `apps/api/src/config/api-env.schema.ts` (+ its test) and
`apps/api/src/app.module.ts`.

### Port and token

Mirror `STORAGE_PORT` / `BRANDING_RESET_CLEANUP_PRODUCER` exactly: an exported
`Symbol` token plus an `interface`, so tests can `overrideProvider` it and the
module can `useFactory` it.

```ts
export const FISCAL_PROVIDER = Symbol("FISCAL_PROVIDER");

export interface FiscalProviderPort {
  readonly provider: FiscalProvider; // the Prisma enum from @newsaas/database
  issue(request: FiscalIssueRequest): Promise<FiscalIssueResult>;
}
```

`provider` is a readonly identity field so the Fiscal service can assert which
implementation answered without importing one.

**`cancel` is deliberately NOT on the port in this slice.** DEC-048 says the
epic defines a port with "issue/cancel capabilities"; that is satisfied across
the epic, not in one slice. A `cancel` method now would be an untested method
with no caller, which is the over-specification mistake FISC-002 already paid
for. It lands in [[FISC-005]] with the cancellation flow that uses it, and this
note is the hand-off.

### Request DTO

The fiscal representation of the invoice's frozen snapshot. Money crosses as
**decimal strings**, never numbers (repo-wide Decimal discipline), and the DTO
carries no Prisma model, no tenant secret and no credential.

```ts
export interface FiscalIssueRequest {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
  readonly provider: FiscalProvider;
  readonly invoice: {
    readonly series: string;
    readonly number: number;
    readonly currency: string;
    readonly issuedAt: string; // ISO 8601 UTC
  };
  readonly lines: readonly FiscalIssueLine[];
  readonly totals: {
    readonly taxableBase: string;
    readonly taxAmount: string;
    readonly total: string;
  };
}

export interface FiscalIssueLine {
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly rateCode: string;
  readonly taxableBase: string;
  readonly taxAmount: string;
  readonly lineTotal: string;
}
```

### Result taxonomy

A **discriminated union**, not a thrown `DomainError`. Rationale to record: the
outcome is data the Fiscal service must classify, persist as state plus
attempt/error metadata, and decide retryability on; a thrown error would lose
that structure and force `try`/`catch` classification. `ERROR_CODES` in
`packages/shared/src/errors/registry.ts` is frozen, append-only and describes
HTTP-mapped failures, which a provider outcome is not.

Literal set is DEC-049's four classes plus the approved success case, which
collapses DEC-048's looser wording onto DEC-049's precise one:

```ts
export type FiscalIssueOutcome =
  | "APPROVED" // success
  | "REJECTED" // terminal: provider rejection
  | "FUNCTIONAL_REJECTION" // terminal: functional/schema rejection
  | "CONFIGURATION_ERROR" // terminal: configuration error
  | "TRANSIENT_FAILURE"; // retryable

export interface FiscalIssueResult {
  readonly outcome: FiscalIssueOutcome;
  readonly externalId: string | null; // preserved when the provider reached the document
  readonly cdc: string | null;
  readonly reasonCode: string | null; // stable, non-secret
  readonly reason: string | null; // non-secret, truncated
  readonly retryAfterMs: number | null; // transient only
  readonly providerRequest: unknown; // RAW; sanitized before persistence
  readonly providerResponse: unknown; // RAW; sanitized before persistence
  readonly resolvedAt: string; // ISO 8601 UTC
}

export function isRetryableOutcome(outcome: FiscalIssueOutcome): boolean;
```

`isRetryableOutcome` is `outcome === "TRANSIENT_FAILURE"` and nothing else:
DEC-049 makes every other class terminal. That single predicate is the contract
FISC-004's retry decision reads, so it ships with its own unit test rather than
being inlined at the call site.

### Fake determinism

DEC-048 requires "deterministic outcomes from controlled non-secret test/dev
inputs". Pinned mechanism: an **ordered outcome script** supplied at
construction, consumed one entry per `issue` call, defaulting to a single
`APPROVED`.

```ts
export interface FakeFiscalProviderOptions {
  readonly outcomes?: readonly FiscalIssueOutcome[]; // default ["APPROVED"]
  readonly externalIdPrefix?: string; // default "fake"
}

export function createFakeFiscalProvider(
  options?: FakeFiscalProviderOptions
): FakeFiscalProvider;
```

Determinism rules, each with a test:

- the nth call returns the nth scripted outcome; a script shorter than the call
  count keeps returning its **last** entry rather than failing, so a long-lived
  dev process is stable;
- `externalId` is `"<prefix>-<n>"` with `n` the 1-based call index, so it is
  reproducible and never random;
- `TRANSIENT_FAILURE` carries a non-null `retryAfterMs` and `APPROVED` carries a
  non-null `externalId`; `REJECTED`/`FUNCTIONAL_REJECTION`/`CONFIGURATION_ERROR`
  carry a stable `reasonCode` and a `null` `externalId` when the provider never
  reached a document;
- the fake produces **no SIFEN XML, no signature and no protocol artefact** —
  its raw payloads are plain JSON describing the outcome, because PRD §23
  forbids implementing protocol details from memory.
  `xmlStorageKey`/`kudeStorageKey` stay null in EPIC-15.

The script is a constructor option rather than an env var: it is the input tests
already control, and a second fiscal env var would be config surface with no
consumer outside tests.

### Sanitization

DEC-050 and PRD §41. Pinned as **allowlist, fail closed, redact rather than
throw**:

```ts
export function sanitizeProviderSnapshot(
  value: unknown,
  options?: { readonly maxDepth?: number; readonly maxStringLength?: number }
): { readonly snapshot: unknown; readonly redactedPaths: readonly string[] };
```

Rules, each with a test:

- only a closed allowlist of scalar keys survives: `provider`, `externalId`,
  `cdc`, `state`, `status`, `statusCode`, `reasonCode`, `message`, `timestamp`;
- every other key is replaced by the marker `"[redacted]"` and its dotted path
  is recorded in `redactedPaths`, so a reviewer can see what was dropped without
  reading the dropped value;
- secret-shaped keys (`authorization`, `certificate`, `pin`, `password`,
  `privateKey`, `secret`, `token`, and any key matching `/key|pem|cert/i`) are
  always redacted even if they appear inside an allowlisted key's value object;
- recursion is bounded by `maxDepth` (default 4) and every string is truncated
  to `maxStringLength` (default 512) with a `"…"` suffix, so a hostile payload
  cannot blow up a row;
- arrays are sanitized element-wise and their index is part of the dotted path;
- the function **never throws** on shape: an unknown payload is redacted, not
  rejected, because a rejection inside a submission path would turn a safe
  payload into a failed document;
- the sanitizer is applied by the Fiscal boundary before persistence, and the
  port contract states that implementations return raw payloads that must be
  sanitized — belt and braces, with a test asserting the sanitizer is pure (no
  mutation of its input).

### Provider selection and the production gate

One new optional env var in `apps/api/src/config/api-env.schema.ts`:

```text
FISCAL_PROVIDER   optional   closed set: "fake"   (EPIC-16 adds "third_party")
```

`FiscalModule` provides the token with a factory that reads `apiEnv(...)`:

- non-production, unset → `createFakeFiscalProvider()`;
- `FISCAL_PROVIDER=fake` explicitly set → the fake, anywhere. This is the
  documented dedicated-demo path in `docs/03-architecture/DEMO-TENANT.md`
  ("unless a dedicated approved demo environment is being provisioned");
- `NODE_ENV=production` and unset → **refuse at boot**, via the same
  `superRefine` gate pattern the branding asset secret already uses. Rationale:
  there is no production fiscal provider until EPIC-16, and silently emitting
  non-fiscal documents is worse than failing fast. This mirrors the existing
  production gate's own recorded intent, "operators fail fast at boot instead of
  serving assets signed with an insecure secret".

### Boundary rule

Mirror `apps/api/src/patients/veterinary-boundary.test.ts` and
`apps/web/src/components/portal/portal-no-staff-imports.test.ts`: walk
`apps/api/src`, extract import specifiers, and assert that the **concrete**
implementation module (`fake-fiscal.provider`) is imported by nothing outside
`apps/api/src/fiscal/` — the composition root `fiscal.module.ts` and the fiscal
tests are the only allowed importers. The test self-tests its extractor against
each import form, as the portal test does.

In this slice no file under `apps/api/src/billing/` imports anything from
`fiscal/` at all; the rule becomes "imports the port only" when [[FISC-004]]
wires the issue command.

### Not in this slice

- No `cancel` on the port (FISC-005).
- No Fiscal service, repository, controller, route or permission wiring; the
  `fiscal.invoice.issue` permission stays consumed by no route, exactly as
  FISC-002 left it.
- No database write and no migration. `FiscalDocument` is not touched, so the AC
  "provider outcomes update only Fiscal-owned state through Fiscal services" is
  satisfied vacuously here and is exercised by FISC-004.
- No `STORAGE_KEY_PREFIXES` addition: the fake writes no artifact. The fiscal
  prefix lands with the first real artifact producer in EPIC-16.
- No queue, no retry loop and no BullMQ (FISC-004).
- No `fiscal-ui` settings namespace (FISC-005).

## Tasks

- [x] T1 — Pin this contract into the FISC-003 story file (In Scope, API, Domain
      Invariants, Tests, Known Limitations, Files/Modules).
- [x] T2 — Add the port, the token, the DTOs and `isRetryableOutcome`.
- [x] T3 — Add `FakeFiscalProvider` with its deterministic script and outcomes.
- [x] T4 — Add `sanitizeProviderSnapshot` with its allowlist, bounds and purity.
- [x] T5 — Add `FiscalModule` wiring plus the `FISCAL_PROVIDER` env var and its
      production gate; register the module in `app.module.ts`.
- [x] T6 — Add the three unit suites and the source-text boundary test;
      reconcile any module-inventory assertion the new module disturbs. No
      module-inventory or wiring assertion needed reconciliation.
- [ ] T7 — Verify: focused suites, `pnpm test`, `typecheck`, `lint`,
      `format-check`; then the native review. Every gate is green; the native
      review is the remaining step.

## Contract correction during implementation

The pinned contract said the port would import the `FiscalProvider` enum from
`@newsaas/database`. That package keeps `@prisma/client` private and re-exports
only the `Prisma` namespace, which does not expose the enums, so the import did
not typecheck. The port now declares its own frozen vocabulary, mirroring
`billing.zod.ts`'s `INVOICE_STATUS_VALUES` — which is also the better boundary,
since a port should not depend on the persistence layer's generated types.

A second refinement: the closed `FISCAL_PROVIDER` set was declared twice (in the
schema and again in the module factory). It is now a single exported constant
that both read.

## Notes

- Base commit `83abe73` (merged `main`, EPIC-15 kickoff + FISC-002). Branch
  `feat/epic-15-fiscal-interface-and-fake`.
- No commit or push happens without the parent's workflow step; the parent owns
  commits and the review lifecycle.
- Unit tests under `apps/api/src/fiscal/` need **no** database, so this slice
  has no live-PostgreSQL gate — the failure mode that cost FISC-002 fifteen
  defects does not apply here, and the executable gate is
  `pnpm --filter @newsaas/api test src/fiscal/<file>.test.ts`.
