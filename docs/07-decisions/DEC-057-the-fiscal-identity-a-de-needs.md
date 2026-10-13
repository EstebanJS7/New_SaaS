---
id: DEC-057
type: decision
title:
  The fiscal identity a DE needs — the four product decisions FISC-015 must make
status: accepted
date: 2026-10-10
related_epics:
  - EPIC-16
related_stories:
  - FISC-015
  - FISC-012
  - FISC-013
prd_change_required: false
---

# DEC-057 — the fiscal identity a DE needs

## Context

[[DEC-056]] stopped [[FISC-012]]'s document stage because the assembly's
**inputs** are unmodelled, and created [[FISC-015]] to produce them. Its first
work unit was written as "make the four product decisions before any schema
change". This document makes them, from a retrieval on 2026-10-10 that read the
Manual v150, the Notas Técnicas that amend it, the official XSDs, the
habilitación's own guide and the Guía de Pruebas.

**What the sources turned out to say, and what they do not.**

- **The Manual is not the current rule set.** The Notas Técnicas amend it, and
  for the receptor and the IVA they change it materially: NT 023 reworded the
  identity fields, NT 010 and NT 023 added the innominado constraints, NT 020
  added the state-entity rule, NT 021 added a threshold, and **NT 013 replaced
  the IVA formulas** and added `E737`.
- **The Manual does not distinguish _exento_ from _exonerado_.** It labels
  `iAfecIVA = 2` as "Exonerado (Art. 83- Ley 125/91)" and `= 3` as "Exento", and
  then says both take rate `0` and zero base and liquidation. No sentence
  decides which one a 0% operation _is_. The XSD cites a **different and newer**
  article ("Exonerado (Art. 100 - Ley 6380/2019"), and that article was modified
  by Ley 7067/2023.
- **The innominado rule is a Nota Técnica, not the Manual.** The Manual gives
  three annotations (`D208 = 5`, `dNumIDRec = 0`, `dNomRec = "Sin Nombre"`); the
  constraints that it is only valid for B2C, never for NC/ND/NR, and not above a
  threshold are validations `D208b`/`D208e`/`D208f`/`D208c` from NT 010, 021
  and 023.
- **The catalogues are the protocol's own.** `Monedas_v150.xsd` carries each
  currency's code **and its name** (`PYG → Guarani`), and
  `Unidades_Medida_v141.xsd` carries each unit's code and description
  (`77 → Unidad - UNI`). Neither is tenant data.
- **The CSC is issued by the DNIT and never by us.** The Manual §13.8.1: 32
  alphanumeric characters, "generado por el SIFEN y entregado al facturador
  electrónico al momento de su ingreso", up to two active. The Guía de Pruebas
  prints the test environment's two: `IdCSC 0001 / CSC ABCD0000…` and
  `IdCSC 0002 / CSC EFGH0000…` — the first of which is exactly the CSC in the
  Manual's own worked example.

## Question

Four, in order, because the second and third depend on the first.

## Options

### 1. What a rate code means fiscally

The DE's per-item IVA block needs `iAfecIVA` (`E731`), `dTasaIVA` (`E734`),
`dPropIVA` (`E733`), `dBasGravIVA` (`E735`), `dLiqIVAItem` (`E736`) and
`dBasExe` (`E737`). The invoice carries `rateCode` (a foreign key to `tax_rate`)
and its own money; `tax_rate.rate` is a `Decimal(5,2)`, so the **rate** is
already modelled.

**Option A — the tenant declares the affectation per rate code.** `tax_rate`
gains the fiscal classification (the `iAfecIVA` value, and optionally the
proportionality for a partially taxed line). The rate stays where it is.

**Option B — derive the affectation from the rate.** A positive rate becomes
`1 = Gravado IVA`, a zero rate becomes `3 = Exento`.

**Option C — a new mapping table** from rate codes to fiscal classifications,
leaving `tax_rate` alone.

### 2. What a receptor is

`Customer` has `kind`, `displayName`, `legalName`, `taxId`, `firstName`,
`lastName`, `documentNumber`, addresses and contacts. The DE's receptor block
needs `iNatRec`, `iTiOpe`, `cPaisRec`, `dDesPaisRe`, `iTiContRec`, `dRucRec`,
`dDVRec`, `iTipIDRec`, `dDTipIDRec`, `dNumIDRec`, `dNomRec` and, conditionally,
the address, the department and the city.

**Option A — derive everything derivable, and refuse the rest.** `iNatRec` from
`taxId`; `iTiContRec` from `kind`; `dRucRec` from `taxId` with its check digit
computed; `iTipIDRec`/`dNumIDRec` from `documentNumber`; the innominado case
from having neither; `cPaisRec = PRY`. **`iTiOpe` is the one the code cannot
derive**: the state-entity determination needs the DNIT's own padrón, so the
tenant declares it (per customer, defaulting from `kind`).

**Option B — the tenant declares the whole receptor block**, and the invoice's
customer is only a label.

**Option C — refuse to issue to a receptor the system cannot classify**, so a
tenant that has not declared its customers' operation types cannot issue at all.

### 3. Where the CSC lives

**Option A — a per-tenant secret with its identifier**, in the shape [[DEC-055]]
Q2 already chose: the value sealed in the secret store behind a reference, the
`IdCSC` in the tenant's fiscal row, and **one pair per environment**, because
the test environment's CSC is generic and the production one is issued at the
emitter's onboarding.

**Option B — a tenant setting.** Simpler, and wrong: a secret in a settings row
is readable by anything that reads settings.

**Option C — per establishment or per range.** Nothing in the sources suggests
it; the CSC identifies the _taxpayer_, not the point of expedition.

### 4. Which establishment, point and document type issue

`iTiDE` (`C002`), `dEst` (`C005`) and `dPunExp` (`C006`) identify the
authorization the document is issued under, and `FISC-011`'s
`fiscal_timbrado_range` already stores all three per row, with the number's
allocation inside it.

**Option A — the tenant declares a default issuance point**, and the allocation
uses it. One row per tenant in the fiscal profile, validated against an ACTIVE
range at issuance.

**Option B — derive it from the tenant's ACTIVE ranges**, refusing when more
than one is active.

**Option C — the caller picks it per invoice.** The most flexible and the one
that lets an invoice be issued under a range the tenant did not mean.

## Recommendation

**1 — Option A, with the rate staying in `tax_rate` and the classification
alongside it.** The Manual's silence on _exento_ versus _exonerado_ is decisive:
a code that derives the affectation from the rate would have to _choose_ a legal
characterisation for a 0% operation, and it would choose wrong for whichever
tenant the choice does not fit. The tenant knows which of the two applies — it
is their tax position — and the system's job is to carry it, validate it and
refuse the combinations the protocol forbids. The rate is derived, not declared:
it is already in `tax_rate.rate`, and the validations `E735a`/`E735b`/`E737`
(NT 013) mean SIFEN recomputes the bases from it.

**2 — Option A.** Every field the sources pin is derived, and the one they do
not is declared. `iTiOpe` is not a guessable value: `B2G` depends on the DNIT's
own registry of state entities, and `B2B`/`B2C`/`B2F` depend on facts the tenant
knows. The validations are then ours to enforce before SIFEN does: innominado
only for `B2C`, never for a credit note, a debit note or a remission note, and
not above the threshold NT 021 sets.

**3 — Option A.** The value is secret by the sources' own words ("teniendo esta
y el contribuyente el conocimiento exclusivo"), it is issued per taxpayer, and
the test environment's pair is generic while production's is not — so the model
is per tenant **and** per environment, exactly as the signing material already
is. `IdCSC` is stored beside it because the QR carries the identifier and not
the value.

**4 — Option A, with Option B's validation.** A tenant-level default is what
makes issuance deterministic, and it is what lets the allocation happen inside
the confirmation transaction [[DEC-056]] chose. The validation is Option B's:
the declared point must resolve to exactly one ACTIVE range, and issuance
refuses when it does not.

## Impact

### Product

- **The tenant gains a fiscal classification to maintain**: which affectation
  each of its rate codes carries, which operation type its customers are, and
  which establishment and point it issues from. That is a real onboarding task
  and the reason this document exists rather than a default.
- **A tenant that has not done it cannot issue**, which is the honest failure:
  the alternative is a document that misstates a tax treatment.

### Architecture

- No new service, no new dependency, no new abstraction.
- `packages/fiscal` stays Prisma-free: the classification is read through
  `@newsaas/fiscal-persistence`, where [[FISC-012]]'s readers already live.
- The CSC's read joins the credential read's shape: a secret behind a reference,
  read when the QR is built, never logged, never in a URL.

### Database/API

- `tax_rate` gains the fiscal classification (one column, or one small table).
- The fiscal profile gains the default issuance point and the CSC's reference
  and identifier.
- `customer` gains the operation type, or the fiscal profile carries a default
  for it.
- **One migration**, additive, with the tenant-isolation proof each new
  aggregate requires.

### Delivery

- [[FISC-015]] becomes implementable in the order its own story predicted: the
  decisions, then the schema, then the reads, then the assembly.
- [[FISC-013]]'s homologation is **not** unblocked by this document: it needs a
  habilitación, a certificate from a PSC and the production CSC, and its test
  plan needs the **events** (see [[FISC-013]]).

## Decision

**Accepted 2026-10-10** by the maintainer, on all four recommendations:

1. **A rate code's fiscal meaning is the tenant's declaration**, carried beside
   the rate in `tax_rate`; the rate itself is derived, never declared.
2. **The receptor is derived where the sources pin it and declared where they do
   not** — `iTiOpe` is the one the tenant declares, because the state-entity
   determination depends on the DNIT's own registry.
3. **The CSC is per tenant and per environment, sealed in the secret store**,
   with its `IdCSC` beside the reference.
4. **The tenant declares a default issuance point**, validated at issuance
   against exactly one ACTIVE timbrado range, so the allocation stays inside the
   confirmation transaction [[DEC-056]] chose.

The four are implemented by [[FISC-015]]: the schema delta in its first
implementation unit and the assembly in the last one. **No default is invented
for any of the four**: a tenant that has not declared its classification, its
operation types, its CSC or its issuance point cannot issue, which is the
failure this document chose over a document that misstates a tax treatment.

## PRD Update

No. This document records product decisions inside approved scope: PRD §22 and
§23 already require a fiscal identity for a DE; what changes is which of its
values the tenant declares and which the system derives.

## What this document does not decide

- **The legal characterisation of a 0% operation.** It is the tenant's tax
  position, cited to art. 100 of Ley 6380/2019 as modified by Ley 7067/2023 for
  _exonerado_, and left to the tenant for the rest.
- **Whether the state-entity list is ever fetched from the DNIT.** The
  recommendation declares the operation type instead; a later decision could
  replace the declaration with the registry.
- **The units of measure.** `Unidades_Medida_v141.xsd` is the protocol's list,
  but _which_ unit a catalog item is, is tenant data and needs a field or a
  default.
