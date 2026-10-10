---
id: EPIC-16
type: epic
title: SIFEN Direct
status: in-progress
priority: high
depends_on:
  - EPIC-15
prd_sections:
  - "22"
  - "23"
  - "27"
  - "36"
  - "38"
  - "39"
  - "40"
  - "41"
created: 2026-10-03
updated: 2026-10-08
---

# EPIC-16 — SIFEN Direct

> **Renamed 2026-10-03.** This epic was planned as _Fiscal Third-party Adapter_
> (`THIRD_PARTY`, PRD §22's MVP path). The maintainer chose to own the
> e-invoicing integration directly instead of routing it through a commercial
> API, so EPIC-16 is now **SIFEN Direct**. Every existing reference to "EPIC-16
> the provider" in older Stories remains substantively correct: EPIC-16 still
> delivers the production provider — it is now ours rather than a vendor's. The
> vendor research is retained as historical evidence in
> [[Fiscal provider candidates]] and is no longer the plan of record.

## Objective

Implement `SifenDirectFiscalProvider`: the third and final step of
`docs/06-fiscal/SIFEN.md`'s sequence
(`FakeFiscalProvider → ThirdPartyFiscalProvider → SifenDirectFiscalProvider`),
in which this system generates, signs and submits Paraguayan electronic tax
documents (DTE) to SIFEN directly, with no commercial intermediary.

[[EPIC-15]] built the boundary: the provider port, the deterministic fake, the
fail-closed snapshot sanitizer, the queued submission with its claim lease and
recovery sweep, the status transition guard, the explicit issue and cancel
commands, the read contract and the staff surface. EPIC-16 replaces the fake
with a real implementation of that same port, and pays the costs the fake let us
defer: XML, signatures, certificates and a real web service.

## The hard precondition (PRD §23)

**No SIFEN implementation work may start before the official DNIT baseline is
revalidated.** PRD §23 states it directly:

> Direct SIFEN implementation is intentionally deferred behind the provider
> boundary. Before implementing `SifenDirectFiscalProvider`, revalidate current
> official DNIT: Manual Técnico; XSD; XML structures; Notas Técnicas; test
> guide; environment/certification requirements. **Do not implement protocol
> details from memory.**

`docs/06-fiscal/SIFEN.md` repeats the rule and adds the reason: this vault's
notes go stale, and the protocol must come from DNIT at the time of
implementation. That is why **FISC-006 is a documentation-only revalidation
story and is the epic's first work unit**, and why the technical content of
every story after it is **provisional** until FISC-006 lands.

The regulatory clock is real: DNIT's _Resolución General N.° 41/25_ (24
December 2025) requires taxpayers contracting as state providers from **2
January 2026** onward to adhere to SIFEN, and its article 3 points at _Decreto
n.° 872/2023_ and the SIFEN technical documentation rather than at any vendor's
word.

## Scope

- **The DNIT baseline, revalidated and cited** — Manual Técnico (current
  version), XSDs, XML structures, Notas Técnicas, the test guide, and the
  environment/certification requirements.
- **DTE XML generation** against the official XSDs, schema-validated before
  submission, for the document types the product actually issues.
- **XMLDSig signing** with the tenant's certificate ([[ADR-006]]: SIFEN v150
  asks for XML Digital Signature, not XAdES), including the return of the
  `SIGNING` lifecycle state that [[DEC-047]] deliberately omitted while a fake
  stood in for the provider.
- **The tenant's signing material in the `SecretStore`** — a private key this
  system must hold and never log. The operator's PKCS#12 and its password are
  the input; the password never persists ([[DEC-053]]). This is the opposite of
  the third-party plan, where the certificate stayed with the vendor.
- **The DNIT web services**: reception, query and events, with explicit handling
  of the asynchronous outcomes SIFEN produces.
- **Timbrado and numbering ranges** per establishment, point of expedition and
  document type, plus the numbering rules SIFEN imposes.
- **Contingency handling** for the periods SIFEN defines, so a DNIT outage does
  not silently lose a document.
- **Certification/homologation evidence**: what was tested, in which
  environment, with which result.

## Out of Scope

- **Any commercial fiscal API.** The vendor adapter is not built; the research
  in [[Fiscal provider candidates]] is retained as evidence, and the
  `THIRD_PARTY` enum value stays in the schema unused.
- **KuDE rendering as a printable document layout.** EPIC-16 persists the
  artifacts SIFEN and the signing produce; designing a print layout is a
  document/rendering concern.
- **The customer portal fiscal document surface** — still [[TD-022]].
- **Reports and dashboards** — [[EPIC-18]].
- **Notification delivery** (email/WhatsApp of a document) — [[EPIC-17]].
- **Production hardening, observability SLOs and load testing** — [[EPIC-20]].
- **New deployables.** SIFEN Direct lives in the existing `api` and `worker`.

## Acceptance Criteria

- [ ] The DNIT baseline is revalidated and cited with publisher, version and
      date, and every protocol constant in the code traces to a cited source.
- [ ] A DTE XML validates against the official XSD before any submission.
- [ ] A tenant's signing material is stored as RESTRICTED material, never in
      plaintext, never in a log, never in an application record, and is
      removable and rotatable.
- [ ] Signing produces a verifiable XMLDSig signature and drives the `SIGNING`
      state. ([[FISC-009]] implemented it against the profile of
      `SIFEN-BASELINE.md` §5; the criterion stays open until the epic closes.)
- [ ] The DNIT web services are called outside database transactions, with
      bounded retry for transient failures and no retry for functional or schema
      rejections (PRD §22).
- [ ] Timbrado and numbering ranges are enforced per establishment, point and
      document type.
- [ ] Contingency behavior is explicit and tested.
- [ ] `SIFEN_DIRECT` is selectable through `FISCAL_PROVIDER`, and a production
      boot still refuses to select the fake.
- [ ] Tenant isolation is enforced on every new aggregate and every new read.
- [ ] Backend authorization is enforced on every new route and command.
- [ ] The certification/homologation run is recorded as evidence, or explicitly
      recorded as not yet performed.
- [ ] EPIC-16 exits with required checks green or explicit non-green evidence
      recorded.

## Stories

| Story    | Scope                                                                                                                                                                                                                                                                                                                                                                                   | Depends on         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| FISC-006 | **SIFEN Direct scope and the DNIT baseline revalidation** — documentation only; the epic's precondition and the source of every protocol constant                                                                                                                                                                                                                                       | —                  |
| FISC-007 | **Tenant signing material**: the `SecretStore` boundary for the private key (RESTRICTED), rotation and removal — [[ADR-005]] + [[DEC-053]]                                                                                                                                                                                                                                              | FISC-006           |
| FISC-008 | **DTE XML generation**, validated against the official XSDs                                                                                                                                                                                                                                                                                                                             | FISC-006           |
| FISC-009 | **XMLDSig signing** (not XAdES — see [[ADR-006]]) and the return of the `SIGNING` lifecycle state. The worker stage that claims it moved to FISC-012                                                                                                                                                                                                                                    | FISC-007, FISC-008 |
| FISC-010 | **DNIT web services**: reception, query, events, and the asynchronous outcome model — [[ADR-007]] + [[ADR-008]]                                                                                                                                                                                                                                                                         | FISC-008, FISC-009 |
| FISC-011 | **Timbrado and numbering ranges** per establishment, point and document type                                                                                                                                                                                                                                                                                                            | FISC-006           |
| FISC-012 | **`SifenDirectFiscalProvider`** behind the existing port — it **implements** the asynchronous capability [[FISC-010]] adds — provider selection, **the worker's document stage** moved from FISC-009 (the claim, the credential, the custody and the XSD gate; **the assembly moved to FISC-015**) and the reconciliation stage — [[ADR-009]] + [[ADR-010]] + [[DEC-055]] + [[DEC-056]] | FISC-010, FISC-011 |
| FISC-013 | **Contingency handling** and the certification/homologation evidence run                                                                                                                                                                                                                                                                                                                | FISC-012           |
| FISC-014 | **Epic closure**: module docs, CI evidence, changelog, roadmap, advisory triage                                                                                                                                                                                                                                                                                                         | all                |
| FISC-015 | **The document assembly** — the fiscal identity a DE needs before it can be built: the number's authorisation at confirmation, the receptor, each line's tax treatment, the unit of measure, the currency table and the CSC's storage — [[DEC-056]]                                                                                                                                     | FISC-011, FISC-012 |
| FISC-016 | **The cancellation event** — profiling `Evento_v150.xsd` (retrieved but unread), building and signing the event's payload, and mapping `rRetEnviEventoDe` onto the port's cancel outcomes. Until it lands `cancel` fails closed                                                                                                                                                         | FISC-012           |

Story numbering continues the Fiscal prefix (`FISC-`). FISC-001..005 belong to
[[EPIC-15]].

**FISC-015 was created mid-epic (2026-10-08), and it is the honest shape of a
finding rather than a plan.** [[FISC-012]]'s WU-D was written as "the worker
builds the DE"; a read-only reconnaissance found that the build's **inputs** are
unmodelled — the invoice's link to the timbrado range that would authorise its
number, the receptor's fiscal identity, each line's `iAfecIVA`/`ivaRate`, the
unit of measure, the currency description and the CSC's storage — and
[[DEC-056]] records the evidence, the options and the decision: FISC-012 keeps
the stage's four own properties (the claim, the credential, the custody and the
gate) and **fails closed** on the assembly, which moves to FISC-015. The same
decision moves the fiscal number's allocation to **invoice confirmation**, so a
printed invoice carries a number a timbrado authorises and a failed submission
burns none.

**FISC-010's service layer is fully pinned, and a first reading of it was wrong
(2026-10-08).** The v150 **batch** schemas do not exist (HTTP 404 by every name
the Manual's index uses), so the batch shapes are the v141-published ones; the
WSDL is unreadable on both hosts (`302 → /vdesk/hangup.php3`, host-wide — a
bogus path answers the same). And the two consultation services were first
recorded as **blocked** on a request signature no source pins: that was wrong.
The published v150 consultation schemas (`siConsultaDTE`,
`siConsultaArchivoRuc`) are **different services** — by authorization protocol,
by date range, and the RUC archive, all signed and all returning ZIPs — while
the Manual's §9.4 and §9.6 pin the two services the endpoint list names as
**unsigned** (`rEnviConsDe { dId, dCDC }` and `rEnviConsRUC { dId, dRUCCons }`),
which the published v141 artifacts (`WS_SiConsDE_v141.xsd`,
`WS_SiConsRUC_v141.xsd`) and the October-2024 Guide confirm. The blocker was a
search not yet run; the correction is recorded in `SIFEN-BASELINE.md`
§23.6/§23.8 and in the Story. The signed family's own signature profile stays
open and out of scope.

**FISC-012 closed 2026-10-09.** All six work units landed on
`feat/epic-16-fisc-012-sifen-direct-provider` (`7949f04` … `0bdedac`), each with
a record commit beside it. The Story replaced the fake with the real adapter,
gave the worker a document stage, and made the reconciliation walk the documents
SIFEN has not resolved. **Two CRITICAL findings arrived before their commits** —
a production deployment that could have targeted the DNIT test host, and a sweep
one poisoned row could stop — and both were corrected and validated. **Two
findings changed the plan instead of the code**, and each produced a story:
[[FISC-015]] for the assembly ([[DEC-056]]), which the worker's stage now fails
closed against, and [[FISC-016]] for the cancellation event, which is why
`cancel` refuses. [[TD-028]] is closed by the sweep and [[TD-029]] is raised by
its cap. The closure evidence is in `docs/10-qa/CI-EVIDENCE.md`, and the module
doc's limitations list what is deliberately absent.

**FISC-016 was created by FISC-012's own implementation (2026-10-08).** SIFEN's
cancellation is an **event**, and `SIFEN-BASELINE.md` §23.3 records that
`Evento_v150.xsd`'s field-level rules were never profiled — the artifacts were
retrieved (23,255 and 23,320 bytes) and the section says profiling them "is the
work of the Story that builds one". So FISC-012's `cancel` fails closed with a
named reason instead of sending an event nobody validated, and FISC-016 owns the
profiling, the payload, its signature and the answer's mapping.

**Every story from FISC-007 onward is provisional in its technical content**
until FISC-006 lands. The names and dependencies above are the shape; the
constants, the XSD versions, the endpoint list and the state mapping come from
FISC-006 and must not be written from memory.

## Dependencies

- [[EPIC-15]] — the boundary, the queue, the guard and the surface this epic
  implements against.
- A DNIT habilitación as an electronic issuer for the test tenant, and the
  certificate that goes with it, before FISC-013 can produce real evidence.
- ~~An XAdES signing capability.~~ **Resolved by [[ADR-006]] `accepted`
  2026-10-07**: `xml-crypto` 6.3.3 is a dependency of `packages/fiscal`, and the
  target is XMLDSig.

## Exit Criteria

- [ ] Lint/typecheck/tests/build required for the epic are green.
- [ ] The live-PostgreSQL gate covers every new aggregate, guard and constraint.
- [ ] Every protocol constant traces to a cited DNIT source.
- [ ] Documentation is current: `docs/05-modules/Fiscal.md`, the module README,
      CI evidence, changelog and roadmap.
- [ ] The certification/homologation outcome is recorded, including a negative
      or pending result.
- [ ] No secret material is reachable from a log, an API response or a
      repository file.

## Decisions / ADRs

Architectural changes need an **ADR**, because `DOCUMENTATION-RULES.md` names
"change Fiscal Provider boundary" as an ADR case:

1. **Holding the tenant's signing material — [[ADR-005]], `accepted`
   2026-10-04.** EPIC-15's boundary assumed an opaque credential reference.
   SIFEN Direct requires the private key inside our boundary, so [[ADR-005]]
   introduces a reusable `SecretStore` capability with envelope encryption in
   PostgreSQL and records what the Fiscal boundary is now responsible for. Its
   product-level choices are [[DEC-053]]. It is the gate for [[FISC-007]].
2. **An XMLDSig signing dependency — [[ADR-006]], `accepted` 2026-10-07.**
   `AGENTS.md` requires a concrete requirement before a new dependency; signing
   is one, and the choice of library is architectural. **`xml-crypto` 6.3.3
   (MIT)**, a dependency of `packages/fiscal` only. **The family question is
   answered**: `pkijs`/`asn1js` stay what [[ADR-005]] added them for — parsing
   the PKCS#12 container — because **`pkijs` cannot sign XML** (the installed
   `pkijs@3.4.1` has zero `xmldsig` occurrences; it implements CMS/PKCS#7 and
   X.509, a different serialization). **And the vocabulary is corrected rather
   than renamed**: SIFEN v150 does **not** ask for XAdES — `XAdES`,
   `QualifyingProperties` and `SignedProperties` occur **zero times** in the
   three official schemas, and the Manual's §7.9 synthesis reads "Firma **XML
   Digital Signature, Enveloped**". The "XAdES" wording in PRD §23, in this
   epic, in the changelog and in [[FISC-007]]/[[FISC-008]] is inherited from the
   PRD's text, which is **not edited**; the ADR and [[FISC-009]] record that the
   implementation target is the profile of `SIFEN-BASELINE.md` §5. It is the
   gate for [[FISC-009]].
3. **An asynchronous outcome capability on the provider port — [[ADR-007]],
   `accepted` 2026-10-08.** SIFEN answers asynchronously, so `issue` alone is
   not enough; the port needs a way to ask what happened, and the worker needs a
   reconciliation path. **It is the gate for [[FISC-010]], not [[FISC-012]]**:
   FISC-010 is the story that produces the asynchronous result, so the port must
   expose it before FISC-012 consumes it. The epic's earlier "before FISC-012"
   ordering was corrected on 2026-10-07. The ADR adds the `SUBMITTED` outcome
   (non-terminal **and non-retryable**), the `query` capability, the nullable
   `provider_reference` column that persists SIFEN's batch number, and it names
   the TD-028 sweep — extended to `SUBMITTED` — as the reconciliation path, so
   no new scheduling infrastructure is introduced.
4. **The SIFEN transport: SOAP over mutual TLS — [[ADR-008]], `accepted`
   2026-10-08.** The adapter runs inside the worker and the test guide requires
   mutual authentication with the taxpayer's certificate, so the boundary gains
   a per-call credential read on a process-singleton provider, plus an XML
   parser `packages/fiscal` does not have today: its production dependencies are
   `@nestjs/common`, `asn1js`, `pkijs` and `xml-crypto`, and `libxmljs2` is a
   dev dependency for the schema gate. It is the gate for [[FISC-010]]. The ADR
   chooses `node:https` with a per-call mutual-TLS configuration and **no pooled
   socket** (`agent: false`, so no authenticated connection is reused across
   tenants), defines `FiscalCredentialPort.read({ tenantId, environment })` with
   a null-returning default on a `forRoot()`-able module, and adds two MIT
   dependencies — `fast-xml-parser` and `fflate` — with their advisory record
   and the parser's guardrails.
5. **The port's request carries the signed document — [[ADR-009]], `accepted`
   2026-10-08.** A SIFEN provider submits a **signed DE**, and the request
   carries invoice data, because the port was designed while a fake stood in for
   the provider. The provider cannot build the document — that needs the emitter
   profile, the timbrado and the allocation, all in PostgreSQL, and
   `packages/fiscal` depends on neither Prisma nor the database package — and
   the persistence needs the document in the caller's hands. So the **worker**
   builds and signs it, the request gains `document: { cdc, signedXml } | null`,
   and the port gains `requiresSignedDocument` so the caller builds one only for
   providers that need it. It is the gate for [[FISC-012]].
6. **The XSD gate runs before every submission — [[ADR-010]], `accepted`
   2026-10-08.** The epic's own criteria say a DTE XML validates against the
   official XSD **before any submission**, and the gate FISC-008 built is a CI
   job that validates a **fixture**, not the document a tenant submits. The
   validator moves to the runtime barrel, `libxmljs2` becomes a runtime
   dependency of `packages/fiscal`, the schema directory is a deployment input
   (`DTE_XSD_DIR`), and a deployment that cannot validate **cannot submit**. It
   narrows [[ADR-008]]'s "`libxmljs2` stays the dev-only XSD gate" for the
   validation path only; the response parser stays `fast-xml-parser`. It is the
   gate for [[FISC-012]].

## Technical Debt

- [[TD-022]] — the portal fiscal document surface stays deferred.
- [[TD-029]] — the operator-triggered re-drive: EPIC-16 should close it against
  a real provider primitive rather than a local invention.
- [[TD-030]] — the EPIC-15 review advisories, several of which sit in the cancel
  and read paths this epic extends.
- [[TD-026]] — unbounded list endpoints, which the new read surfaces must not
  worsen.
