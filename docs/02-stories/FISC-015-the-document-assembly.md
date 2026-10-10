---
id: FISC-015
type: story
title:
  The document assembly — the fiscal identity a DE needs before it can be built
epic: EPIC-16
status: planned
priority: high
depends_on:
  - FISC-011
  - FISC-012
prd_sections:
  - "22"
  - "23"
permissions: []
branch:
created: 2026-10-08
updated: 2026-10-08
---

# FISC-015 — the document assembly

## Objective

Make the tenant's rows sufficient to build a legally valid DE. [[FISC-012]]
builds, signs, stores and submits a document **when the selected provider
requires one**; this story supplies the document. Its outcome is that the
worker's stage, handed a confirmed invoice, produces a DE whose fiscal
statements — the number's authorisation, the receptor's identity, each line's
tax treatment — come from the tenant's own data and from cited protocol tables,
never from a default an agent chose.

## Context

[[FISC-012]]'s WU-D was written as "the worker builds the DE", and a read-only
reconnaissance on 2026-10-08 found that the **inputs** to that build are largely
unmodelled. [[DEC-056]] records the finding with its evidence, the three options
and the maintainer's decision: FISC-012's stage keeps the four properties that
are its own (the claim, the credential, the document's custody and the XSD gate)
and **fails closed** on the assembly, which moves here.

**What FISC-012 leaves behind for this story**: the stage's seam — the point
where a document would be built — the credential read that serves both the
signature and the mutual-TLS call, the storage writer for `xml_storage_key`, and
the gate that refuses a document the official schema rejects. **What it does not
leave**: any code that decides what a receptor is, what a line's tax treatment
is, or which timbrado authorises the number.

### The six inputs this story must produce

Each is recorded with its evidence in [[DEC-056]]; this is the list to work
from.

1. **The number's authorisation.** [[DEC-056]]'s decision: the fiscal number is
   allocated **at invoice confirmation**, from the timbrado range, inside the
   confirmation transaction, and the range's identity is persisted with the
   invoice or the fiscal document — so the worker **reads** the number and the
   range instead of reconstructing them. This is the first work unit because
   everything else hangs off it: the CDC is built from the number, and the
   reconciliation's identity is the CDC.
2. **The receptor.** `DteReceptor`'s 24 fields against `Customer`'s eight, with
   the derivable ones derived (`iNatRec` from the customer's kind, `dDVRec` by
   módulo 11 — a helper exists in `packages/fiscal/src/dte/dte.cdc.ts`) and the
   rest either modelled or refused. **A walk-in invoice has no customer at all**
   (`Invoice.customerId` is nullable), so the innominado case is a decision, not
   an accident.
3. **The line's tax treatment.** `E731 iAfecIVA` and `E734 ivaRate` from the
   line's `rateCode`. The mapper deliberately refuses to invent these
   (`packages/fiscal/src/dte/dte.mapper.ts:27-30`), and the choice between
   _exento_ and _exonerado_ for a 0% rate is a fiscal statement, not a mapping.
4. **The unit of measure.** `cUniMed`/`dDesUniMed` have no column anywhere.
5. **The currency description.** `dDesMoneOpe` — the cheapest of the six: the
   protocol publishes its own list, so this is a table in `packages/fiscal`, not
   tenant data.
6. **The CSC.** Per-tenant secret material per [[DEC-055]] Q2: where its
   reference lives, how `IdCSC` is stored, and how the secret reaches the QR
   builder without entering a URL, a log or a snapshot.

### The decisions this story needs before its work units are written

These are product decisions, and [[DEC-056]] says so explicitly. The story's
first work unit is to make them, in the house form (a DEC per decision, or one
DEC that carries them all with their citations):

- **What a rate code means fiscally**: which `iAfecIVA`, which rate, and whether
  a 0% rate is exempt or exonerated.
- **What a receptor is**: which operation type, which country, which document
  type, and what an invoice with no customer produces.
- **Where the CSC lives**: which table holds its reference, who writes it, and
  how it is rotated.
- **Which establishment, point of expedition and document type issue**: the
  tenant-level policy that selects the timbrado range, or the explicit statement
  that a tenant has exactly one and it is derived.

## Work units

_Provisional: the shape follows [[FISC-012]]'s pattern — decisions first, then
the data, then the code. The units are pinned when the first one lands._

**WU-A — the decisions.** The four product decisions above, each with its
protocol citation, plus the Story's own detail: the schema delta, the mappings
and the seam's contract. No code.

**WU-B — the number's authorisation.** The confirmation path allocates from the
timbrado range inside its existing transaction, persists the range's identity
beside the invoice, and the live-PostgreSQL proof covers the new invariant (one
number, one range, never reissued, a rolled-over series included). The
`invoice_number_sequence` counter's fate is decided here, not left as a second
truth.

**WU-C — the fiscal data.** The migrations and the reads for the receptor, the
line's treatment, the unit of measure and the CSC's reference, with the
tenant-isolation proof each aggregate requires.

**WU-D — the assembly.** The mapping from the tenant's rows to
`DteMappingInput`, plugged into FISC-012's seam, proven against the official XSD
and against the published worked example of the protocol's own documentation.

**WU-E — the homologation of one real document.** Handed to [[FISC-013]]'s
certification run rather than duplicated here: this unit ends when the
assembly's output is the document FISC-013 submits.

## Out of scope

- **The provider, the stage, the credential and the gate**: [[FISC-012]]'s, and
  already built.
- **The QR**: [[FISC-012]]'s WU-C, complete.
- **Contingency handling**: [[FISC-013]].
- **Re-deriving money**: the invoice's own `taxableBase`/`taxAmount` remain the
  single source; the mapper's comment records why
  (`packages/fiscal/src/dte/dte.mapper.ts:20-30`).

## Dependencies

- [[FISC-012]] — the seam this story plugs into, and the credential read it
  consumes.
- [[FISC-011]] — the ranges, the profile and the allocator; the allocator gains
  its first production caller here.
- **Billing's confirmation path** — the number's allocation moves there, which
  is a change to a confirmed aggregate's transaction and needs its own review.
- **A DNIT habilitación** for a real CSC and the homologation evidence.

## Exit Criteria

- [ ] A confirmed invoice carries exactly one fiscal number, authorised by a
      timbrado range whose identity is persisted with it.
- [ ] Every fiscal statement in the DE traces to tenant data or to a cited
      protocol table; none is a default.
- [ ] A document built from the tenant's rows passes the official XSD and the
      protocol's own worked example.
- [ ] The live-PostgreSQL gate covers every new aggregate, guard and constraint.
- [ ] No secret material — the CSC included — is reachable from a log, an API
      response, a snapshot or a repository file.
- [ ] Lint/typecheck/tests/build green, `format-check` clean, and the worker's
      stage is exercised end to end with a real document.

## Status

**Planned 2026-10-08.** Created by [[DEC-056]]'s decision to narrow
[[FISC-012]]: its WU-D keeps the stage's four own properties and this story
carries the assembly. It is **not started**: its first work unit makes the four
product decisions above, and no schema change happens before they are made.
