---
feature: epic-16-sifen-direct
epic: EPIC-16
status: in-progress
created: 2026-10-03
updated: 2026-10-03
branch: docs/epic-16-fiscal-third-party-kickoff
---

# EPIC-16 SIFEN Direct — ODD task tracker

## Goal

Implement `SifenDirectFiscalProvider`: the third and final step of
`docs/06-fiscal/SIFEN.md`'s sequence. This system generates, signs and submits
Paraguayan electronic tax documents (DTE) to SIFEN **directly**, with no
commercial intermediary.

The epic was planned as _Fiscal Third-party Adapter_ and **was renamed on
2026-10-03** when the maintainer chose to own the integration instead of routing
it through a vendor API. The vendor research is retained as historical evidence
in `docs/06-fiscal/PROVIDER-CANDIDATES.md` and is no longer the plan of record.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.

## The precondition that governs every other task

**PRD §23 forbids writing SIFEN implementation code before the official DNIT
baseline is revalidated**, and `docs/06-fiscal/SIFEN.md` adds that this vault's
notes go stale. Therefore:

- **FISC-006 is documentation-only and comes first.**
- Every technical detail in the stories after it — XSD versions, endpoint list,
  state mapping, signature profile, certificate requirements, contingency
  windows, numbering rules — **comes from FISC-006 and must not be written from
  memory.**
- If FISC-006 cannot retrieve an official source for something, that gap is
  recorded as an open question rather than filled with an assumption.

Regulatory driver, cited: DNIT _Resolución General N.° 41/25_ (Asunción, 24
December 2025) requires taxpayers contracting as state providers from **2
January 2026** onward to adhere to SIFEN; its article 3 points at _Decreto n.°
872/2023_ and the SIFEN technical documentation.

## Governance constraints that bind this epic

- `DOCUMENTATION-RULES.md` names **"change Fiscal Provider boundary"** as an
  explicit ADR case. Three foreseeable changes need one (below).
- `ENGINEERING-RULES.md`: "Secrets never live in Git or plaintext application
  records"; "Private files use signed URLs"; "Never hold a database transaction
  open while waiting on fiscal providers".
- `AGENTS.md`: a new dependency needs a concrete requirement; a new runtime,
  database, queue or data store needs an ADR. SIFEN Direct needs **no new
  deployable**.
- Data classification: the tenant's private key and its password are
  **RESTRICTED**; a DTE's fiscal content is at least CONFIDENTIAL.

## Decisions taken by the maintainer (2026-10-03)

### D1 — Own the integration (accepted)

`SIFEN_DIRECT` is implemented by us. The `THIRD_PARTY` path is not built; the
enum value stays in the schema unused, and the vendor research stays as
evidence.

### D2 — Revalidate before implementing (accepted, and it is PRD §23's own rule)

FISC-006 delivers the cited DNIT baseline first. It is a gate, not a formality:
no story after it may encode a protocol constant that FISC-006 did not cite.

### D3 — The certificate is ours to hold (consequence, not a choice)

Because there is no vendor, the tenant's signing private key and password live
inside our boundary. The third-party plan's "the vendor holds the certificate"
option is gone. This is the epic's single largest risk and the reason ADR
candidate 1 exists.

## ADR candidates (each needs an ADR before the story that requires it)

1. **Holding the tenant's signing material.** Changes what the Fiscal boundary
   is responsible for: RESTRICTED storage, rotation, removal, and what may never
   be logged or returned. → before FISC-007.
2. **The XAdES signing dependency.** Which library, its provenance, its update
   story and how it is pinned. → before FISC-009.
3. **An asynchronous status capability on the provider port.** SIFEN answers
   asynchronously, so `issue` alone is insufficient; the port needs a status
   query and the worker needs reconciliation. → before FISC-012.

## Story plan

| Story    | Scope                                                                                  | Depends on         |
| -------- | -------------------------------------------------------------------------------------- | ------------------ |
| FISC-006 | SIFEN Direct scope and the DNIT baseline revalidation (docs-only)                      | —                  |
| FISC-007 | Tenant signing material in the `SecretStore` (RESTRICTED, rotation, removal) + **ADR** | FISC-006           |
| FISC-008 | DTE XML generation validated against the official XSDs                                 | FISC-006           |
| FISC-009 | XAdES signing and the return of the `SIGNING` state + **ADR**                          | FISC-007, FISC-008 |
| FISC-010 | DNIT web services: reception, query, events                                            | FISC-008, FISC-009 |
| FISC-011 | Timbrado and numbering ranges per establishment, point and type                        | FISC-006           |
| FISC-012 | `SifenDirectFiscalProvider` + the port's async-status extension + **ADR**              | FISC-010, FISC-011 |
| FISC-013 | Contingency handling and the certification/homologation evidence run                   | FISC-012           |
| FISC-014 | Epic closure: module docs, CI evidence, changelog, roadmap, advisory triage            | all                |

## What exists already (verified on merged `main` `4c02473`)

- `packages/fiscal`: the port with `issue` and `cancel`, the deterministic fake,
  the fail-closed snapshot sanitizer, the queue contract, and a composition root
  that refuses a fake in production.
- `apps/api/src/fiscal`: the issue, cancel and read commands, `fiscal.read`, the
  staff surface at `/app/fiscal`, and the `DEC-051` Billing hand-off.
- `apps/worker/src/fiscal-submission`: the consumer, the handler with its
  five-minute claim lease, and the TD-028 recovery sweep.
- `fiscal_document`: the full lifecycle, the transition guard, the sanitized
  snapshot columns, and `xml_storage_key` / `kude_storage_key` written by
  nothing.
- `packages/storage`: `StoragePort`, an S3 driver, an in-memory driver, opaque
  key helpers and a module — reusable for XML/KuDE.
- `packages/fiscal/src/fiscal-snapshot.sanitizer.ts`: already fail-closed, which
  matters more now that real provider payloads and XML exist.

## What does not exist

- No `SIGNING` state: [[DEC-047]] omitted it while a fake stood in for the
  provider. It returns with FISC-009.
- No XML generation, no XSD validation, no signing, no certificate handling.
- No tenant secret material of any kind: no `SecretStore`, no private-key path.
- No DNIT web service client.
- No timbrado or numbering-range model.
- `FISCAL_PROVIDER` accepts only `"fake"`.

## Explicitly out of scope

- Any commercial fiscal API (the vendor research is evidence, not a plan).
- KuDE as a printable document layout.
- The portal fiscal document surface ([[TD-022]]).
- Reports ([[EPIC-18]]), notifications ([[EPIC-17]]), production hardening
  ([[EPIC-20]]).
- New deployables.

## Tasks

- [ ] T1 — Write FISC-006..FISC-014 as Story files and register the epic in the
      roadmap and the module README.
- [ ] T2 — FISC-006: the DNIT baseline revalidation (docs-only, cited sources).
- [ ] T3 — FISC-007: tenant signing material + ADR.
- [ ] T4 — FISC-008: DTE XML + XSD validation.
- [ ] T5 — FISC-009: XAdES signing + `SIGNING` + ADR.
- [ ] T6 — FISC-010: DNIT web services.
- [ ] T7 — FISC-011: timbrado and numbering ranges.
- [ ] T8 — FISC-012: `SifenDirectFiscalProvider` + port extension + ADR.
- [ ] T9 — FISC-013: contingency + certification evidence.
- [ ] T10 — FISC-014: epic closure.

## Notes

- Base: merged `main` `4c02473` (EPIC-15 closed).
- The rename leaves ~20 older Story references to "EPIC-16 the provider" intact
  in substance; the one that became factually wrong (`FISC-003`'s
  `FISCAL_PROVIDER` closed set) is corrected.
- Inherited debt: [[TD-029]] (operator re-drive, closed by FISC-012 against a
  real primitive), [[TD-030]] (EPIC-15 review advisories), [[TD-026]] (unbounded
  lists), [[TD-022]] (portal surface).
