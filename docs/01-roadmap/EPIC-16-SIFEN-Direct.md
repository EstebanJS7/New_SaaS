---
id: EPIC-16
type: epic
title: SIFEN Direct
status: planned
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
updated: 2026-10-03
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
- **XAdES signing** with the tenant's certificate, including the return of the
  `SIGNING` lifecycle state that [[DEC-047]] deliberately omitted while a fake
  stood in for the provider.
- **The tenant's signing material in the `SecretStore`** — a private key and its
  password are RESTRICTED material this system must hold and never log. This is
  the opposite of the third-party plan, where the certificate stayed with the
  vendor.
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
- [ ] Signing produces a verifiable XAdES signature and drives the `SIGNING`
      state.
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

| Story    | Scope                                                                                                                                             | Depends on         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| FISC-006 | **SIFEN Direct scope and the DNIT baseline revalidation** — documentation only; the epic's precondition and the source of every protocol constant | —                  |
| FISC-007 | **Tenant signing material**: the `SecretStore` boundary for a private key and password (RESTRICTED), rotation and removal                         | FISC-006           |
| FISC-008 | **DTE XML generation**, validated against the official XSDs                                                                                       | FISC-006           |
| FISC-009 | **XAdES signing** and the return of the `SIGNING` lifecycle state                                                                                 | FISC-007, FISC-008 |
| FISC-010 | **DNIT web services**: reception, query, events, and the asynchronous outcome model                                                               | FISC-008, FISC-009 |
| FISC-011 | **Timbrado and numbering ranges** per establishment, point and document type                                                                      | FISC-006           |
| FISC-012 | **`SifenDirectFiscalProvider`** behind the existing port, plus the port's asynchronous-status extension and provider selection                    | FISC-010, FISC-011 |
| FISC-013 | **Contingency handling** and the certification/homologation evidence run                                                                          | FISC-012           |
| FISC-014 | **Epic closure**: module docs, CI evidence, changelog, roadmap, advisory triage                                                                   | all                |

Story numbering continues the Fiscal prefix (`FISC-`). FISC-001..005 belong to
[[EPIC-15]].

**Every story from FISC-007 onward is provisional in its technical content**
until FISC-006 lands. The names and dependencies above are the shape; the
constants, the XSD versions, the endpoint list and the state mapping come from
FISC-006 and must not be written from memory.

## Dependencies

- [[EPIC-15]] — the boundary, the queue, the guard and the surface this epic
  implements against.
- A DNIT habilitación as an electronic issuer for the test tenant, and the
  certificate that goes with it, before FISC-013 can produce real evidence.
- An XAdES signing capability. No such dependency exists in the repository
  today; adding one needs an ADR (see below).

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

Two architectural changes are foreseeable and each needs an **ADR**, because
`DOCUMENTATION-RULES.md` names "change Fiscal Provider boundary" as an ADR case:

1. **Holding the tenant's signing material.** EPIC-15's boundary assumed an
   opaque credential reference. SIFEN Direct requires the private key and its
   password inside our boundary, which changes what the Fiscal boundary is
   responsible for and what classification and audit apply.
2. **An XAdES signing dependency.** `AGENTS.md` requires a concrete requirement
   before a new dependency; signing is one, but the choice of library, its
   provenance and its update story are architectural.

A third change is likely and should be assessed in the same pass:

3. **An asynchronous status capability on the provider port.** SIFEN answers
   asynchronously, so `issue` alone is not enough; the port needs a way to ask
   what happened, and the worker needs a reconciliation path.

## Technical Debt

- [[TD-022]] — the portal fiscal document surface stays deferred.
- [[TD-029]] — the operator-triggered re-drive: EPIC-16 should close it against
  a real provider primitive rather than a local invention.
- [[TD-030]] — the EPIC-15 review advisories, several of which sit in the cancel
  and read paths this epic extends.
- [[TD-026]] — unbounded list endpoints, which the new read surfaces must not
  worsen.
