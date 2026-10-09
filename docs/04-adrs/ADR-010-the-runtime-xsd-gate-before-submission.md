---
id: ADR-010
type: adr
title: The XSD gate runs before every submission, not only in CI
status: accepted
date: 2026-10-08
supersedes: []
superseded_by:
related_epics:
  - EPIC-16
related_decisions:
  - DEC-046
  - DEC-054
related_stories:
  - FISC-012
  - FISC-008
  - FISC-013
approval_record:
  decision_proposal: none
  decision_status: accepted
  decision_approval_date: 2026-10-08
  adr_gate_authority:
    AGENTS.md's dependency rule plus this ADR's own reversal of ADR-008's
    "libxmljs2 stays the dev-only XSD gate" for the validation path, and the
    epic's acceptance criterion "A DTE XML validates against the official XSD
    before any submission"
  adr_acceptance_basis:
    authored in FISC-012's WU-A at the maintainer's instruction of 2026-10-08,
    with the operational cost named in the Consequences and the Story
---

# ADR-010 — The XSD gate runs before every submission

## Decision Summary

[[EPIC-16]]'s acceptance criteria say: _"A DTE XML validates against the
official XSD before any submission."_ **Today nothing does that.** The gate
[[FISC-008]] built is a **CI job**: it fetches the three official schemas,
asserts each fetch's HTTP status and byte size, and validates the builder's
output for a **fixture**. It proves the code path is capable of producing a
valid document; it does not validate the document a tenant is about to submit,
whose shape depends on that tenant's data.

This ADR moves the gate to where the document is built:

1. **The validator becomes runtime API.** `validateDeAgainstOfficialXsd` and
   `buildDteEntrySchema` move from `@newsaas/fiscal/testing` to the package's
   runtime barrel; `libxmljs2` moves from `devDependencies` to `dependencies` of
   `packages/fiscal`. `testing.ts` keeps re-exporting them, so nothing that
   already imports them breaks.
2. **The schema directory is a deployment input**, `DTE_XSD_DIR`, populated by
   the fetcher FISC-008 already built (`prepareDteSchemas`, which asserts each
   artifact's HTTP status and byte size).
3. **It fails closed.** A missing directory, a missing schema or an invalid
   document is a `CONFIGURATION_ERROR` (terminal, non-retryable): the document
   is **not submitted**.
4. **The compiled schema is cached per process**, keyed by the directory, so the
   gate costs one validation per submission rather than one schema compilation.

## Context

**Why a fixture is not a document.** `buildDteXml` is data-driven: the emitter
block, the timbrado, the receptor, the items and the totals all come from rows.
The CI gate validates one fixture request. A tenant whose district code is
missing, whose activity list is empty or whose currency triggers the `F023`
obligation produces a _different_ document, and only a validation of **that**
document can refuse it before SIFEN does.

**What the sources say about validating.** Baseline §4 records that the DE's
`rDE` root is pinned by the schema (`dVerFor` must be the three digits `150`,
the CDC is a required `Id`, the child order is fixed) and §21 records the
field-level patterns and enumerations. A document that violates any of them is a
schema rejection at SIFEN, and the Manual's §6.5 means a rejected DE is
resubmitted with the **same CDC** — so a schema violation is not repaired by
resending; it is refused once and has to be fixed. Validating locally is the
only place where that is cheap.

**Why ADR-008 said the opposite, and why that sentence does not govern this.**
[[ADR-008]] recorded that `libxmljs2` _"stays the dev-only XSD gate"_ while
choosing `fast-xml-parser` for the responses, and its reason was specific:
_"Putting a native toolchain into the worker's dependency tree to parse three
known response shapes is a larger change than the problem."_ That sentence is
about **parsing SIFEN's answers**. Validating our own document is a different
need with a different answer, and this ADR changes the dependency's status for
the validation path only: the response parser stays `fast-xml-parser`, and the
schema validator becomes runtime.

**Why the schemas are not committed.** [[FISC-008]] established that the
official XSDs are copyrighted artifacts fetched at the point of use and never
vendored; the CI job is what fetches them. A runtime gate therefore needs the
_deployment_ to provide them, which is the operational half of this decision.

## Why an ADR is Required

`AGENTS.md` requires a concrete requirement before a dependency, and this one is
architectural in two ways beyond that: it **reverses a recorded sentence of an
accepted ADR**, and it introduces an **operational requirement** — a native
module in the worker's image and a schema directory the deployment must supply.
The complexity budget's rule applies: the requirement is concrete (the epic's
own criterion), and the cost is named rather than discovered later.

## Decision

### 1. The runtime surface

```text
@newsaas/fiscal            (runtime barrel)
  validateDeAgainstOfficialXsd(xml, schemaDirectory): Promise<DteXsdValidationResult>
  buildDteEntrySchema(schemaDirectory): DteEntrySchema
  inspectDteSchemas(directory)        the deployment's own pre-flight
  prepareDteSchemas({ directory })    the fetcher, for an ops step
```

`packages/fiscal/package.json` moves `libxmljs2` from `devDependencies` to
`dependencies`. `testing.ts` keeps its re-exports.

### 2. The deployment input

```text
DTE_XSD_DIR   the directory holding the three official schemas
```

The worker resolves it at boot. **Absent, the fiscal document stage cannot
run**: a submission that requires a document fails with `CONFIGURATION_ERROR`
whose reason names the missing directory. That is deliberate — a deployment that
cannot validate must not submit — and it is the operational cost this ADR
accepts.

The directory is populated by `prepareDteSchemas`, which fetches the three
artifacts from the official directory and asserts each one's HTTP status and
minimum byte size, so a deployment step cannot silently produce a partial schema
set. The fetch is unauthenticated: the XSD directory is public (baseline §3).

### 3. The gate

In the worker's document stage, **after signing and after the QR is filled** —
because the signature is part of the document the schema describes — and
**before** the provider is called:

```text
build -> sign -> QR -> validate -> store -> submit
```

A validation failure is a `CONFIGURATION_ERROR` carrying the first schema
diagnostics, and the document is **not** submitted. The signed XML stays on the
row (it was stored before the gate, or the gate runs before the store — either
order is acceptable as long as a refusal leaves the operator able to inspect the
document).

### 4. Caching

The compiled schema is a process-level cache keyed by the directory path. A
submission validates against the cached schema; a deployment that changes the
directory restarts the process.

## Alternatives Considered

### Keep it in CI only

Rejected, and it is the honest name of the status quo: the epic's criterion says
_"before any submission"_, and a fixture validated at build time is not the
document a tenant submits. The gap is exactly the data-dependent shape — the
missing district, the empty activity list, the foreign currency — which is what
a per-document gate catches.

### A pure-JavaScript validator

Rejected. It would add a second XML stack (we already carry `fast-xml-parser`
for responses) with **no XSD support**: `fast-xml-parser` is a tree reader, not
a schema validator. A hand-rolled subset would validate a subset, which is worse
than a gate that is known to be the real one.

### Validating in the API, at the issue command

Rejected: the document does not exist there. It is built in the worker, from
rows the API's command does not read, and the API must not hold the tenant's
private key in its request path.

### Fetching the schemas per submission

Rejected. A network call in the submission path makes every submission depend on
`ekuatia.set.gov.py` being reachable — and the baseline already records that
both hosts answer `302 → /vdesk/hangup.php3` for everything unauthenticated
(§23.5). The deployment fetches once; the submission reads locally.

### Validating in the CI job _and_ keeping `libxmljs2` dev-only, with the runtime

gate deferred to FISC-013

Considered as the smaller change, and rejected because it defers the epic's
criterion to the Story that runs the homologation: FISC-013's job is to prove
the client against a real SIFEN, and a local gate that does not exist yet would
make that run the first time a schema violation is discovered — against the tax
authority instead of against a file.

## Consequences

### Positive

- **The epic's criterion is met per submission**, not per build.
- **A schema violation is refused locally**, where it is a log line and a fixed
  document, instead of at SIFEN, where it is a rejection with the same CDC and a
  transmission deadline running.
- **The deployment's pre-flight is explicit**: `prepareDteSchemas` asserts what
  it fetched, and the worker refuses to submit without it.

### Negative

- **A native module enters the worker's dependency tree.** `libxmljs2` builds or
  fetches a prebuild at install time; the CI already does this for the fiscal
  package, and the worker's production image now needs it too.
- **A deployment must provide `DTE_XSD_DIR`.** A worker without it cannot submit
  a document — fail-closed by decision, and an operational runbook item rather
  than a silent degradation.
- **One more failure mode in the stage**, with its own outcome: a schema refusal
  is a `CONFIGURATION_ERROR`, which the existing sweep can re-drive — and
  re-driving a document whose data is invalid will refuse again. The Story
  records that an operator must fix the profile, not retry.

## Migration / Rollout

No data migration. The package's dependency moves, the exports are promoted
(additive: `testing.ts` keeps them), the worker's env schema gains `DTE_XSD_DIR`
with its boot validation, and the stage gains one step. The CI job is unchanged
and stays: it is the same validation, run against the builder's fixtures, and it
is what proves the schemas are fetchable at all.

## Guardrails

1. **Fail closed.** No directory, no schema, an unreadable schema or an invalid
   document each refuse the submission with `CONFIGURATION_ERROR` — asserted,
   and never a skip.
2. **The validated document is the signed one.** A test asserts the gate runs on
   the output of `signDteXml` with the QR filled, not on the builder's unsigned
   intermediate.
3. **The schema is compiled once per process.** A test asserts two submissions
   compile one schema, so the gate cannot quietly become a per-submission build.
4. **The CI gate stays green and is not replaced.** The runtime gate is
   additive; a build that stops fetching the schemas still fails the CI job.
5. **The diagnostics are bounded.** The refusal carries the first schema errors
   and no document bytes — the XML is CONFIDENTIAL (baseline §22.9's
   classification applies to the document) and never enters an error message.

## References

- `docs/01-roadmap/EPIC-16-SIFEN-Direct.md` — the acceptance criterion this ADR
  satisfies, and the FISC-012 row.
- `docs/04-adrs/ADR-008-sifen-transport-mutual-tls-and-parser.md` — the sentence
  this ADR narrows, and the parser choice it leaves alone.
- `docs/02-stories/FISC-008-dte-xml.md` — the XSD gate, the fetch that asserts
  HTTP and byte size, and why the schemas are never vendored.
- `docs/06-fiscal/SIFEN-BASELINE.md` §3 (the schema directory), §4 and §21 (what
  the schemas pin), §23.5 (why a per-submission fetch is not viable).
- `packages/fiscal/src/dte/xsd-validator.ts`, `xsd-artifacts.ts`,
  `packages/fiscal/src/testing.ts` — the surface this ADR promotes.
