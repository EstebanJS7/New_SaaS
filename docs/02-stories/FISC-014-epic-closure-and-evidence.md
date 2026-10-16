---
id: FISC-014
type: story
title: Epic closure and evidence
epic: EPIC-16
status: done
priority: medium
depends_on:
  - FISC-006
  - FISC-007
  - FISC-008
  - FISC-009
  - FISC-010
  - FISC-011
  - FISC-012
  - FISC-013
  - FISC-015
  - FISC-016
prd_sections:
  - "22"
  - "23"
permissions: []
branch: docs/epic-16-sifen-direct-closure
created: 2026-10-15
updated: 2026-10-15
---

# FISC-014 — Epic closure and evidence

## Objective

Close [[EPIC-16]] only after every implementation Story has merged with CI
receipts: reconcile the Story statuses, record the exit-criteria evidence, keep
the debt records current, move the changelog and the roadmap against evidence,
and state plainly — in the epic, the module record and the QA evidence — that
the **certification run has not been performed** and why.

## Context

- **The Story existed only as a row in the epic's table.** The epic lists
  FISC-014 as "Epic closure: module docs, CI evidence, changelog, roadmap,
  advisory triage", and no file described it. The precedent is [[BILL-005]],
  EPIC-14's closure, so this is that Story's shape applied here.
- **The run this epic exists to make possible has not happened.** FISC-013's
  WU-D — the DNIT's minimum test matrix against the test environment — is
  blocked on operator inputs no repository work substitutes for. The epic's
  acceptance criterion admits this in its own words ("or explicitly recorded as
  not yet performed") and FISC-013's admits "a negative **or pending** result",
  so the closure records it as **pending** and names the blockers rather than
  manufacturing a receipt.
- **Two Story statuses were stale.** FISC-013 was `in-progress` with its WU-C
  merged; [[FISC-015]] was still `planned` although it landed as PR #114.
- **The debt this epic raised is triaged here, not resolved.** Closing an epic
  is not resolving its deferred items.
- **Closure follows evidence, not effort.** A criterion is checked only when its
  named evidence exists and is merged.

## In Scope

- `docs/02-stories/FISC-014-epic-closure-and-evidence.md` — this Story.
- The reconciliation of FISC-006 through FISC-016: status, and for FISC-013 the
  outcome of WU-D as a **pending** result.
- `docs/01-roadmap/EPIC-16-SIFEN-Direct.md` — `status: done`, the criteria
  checked against evidence, the limitation list, and the debt triage.
- `docs/01-roadmap/ROADMAP.md` — the EPIC-16 row and the closure narrative with
  its merged receipts.
- `docs/09-releases/CHANGELOG.md` — the epic's entry.
- `docs/10-qa/CI-EVIDENCE.md` — the closure summary and the homologation's
  pending outcome.
- The closure branch itself, cut from `main` after every Story merged.

## Out of Scope

- **Any source, schema, migration, seed, route, test or UI change.** This Story
  is documentation and evidence only. A defect found during closure belongs to
  the Story that owns it, not here.
- **Performing the homologation run**, or any part of it. It needs the DNIT's
  habilitación, a certificate from a real PSC and the production CSC.
- **The receptor's four event payloads**, the synchronous service, the
  deliberate-invalid harness and the batch composition — the run's remaining
  blockers, which no Story owns yet.
- **A production-readiness claim.** `done` means epic implementation closure
  only.
- **Resolving any debt record**, including [[TD-029]], [[TD-030]], [[TD-031]],
  [[TD-032]], [[TD-033]], [[TD-022]] and [[TD-026]].
- **A PRD edit.** No decision here requires one.

## Acceptance Criteria

- [x] The closure Story exists and describes the epic's exit, with the precedent
      it follows and the blockers it records. Evidence: this file.
- [x] Every Story is reconciled against its merged receipts, and a stale status
      is corrected. Evidence: [[FISC-013]] and [[FISC-015]] at `done`.
- [x] The certification run's outcome is recorded **as pending**, with the
      operator inputs that block it named. Evidence:
      `docs/10-qa/CI-EVIDENCE.md`.
- [x] The debt the epic raised is triaged by status, and no record is resolved
      by closing the epic. Evidence: the epic's Technical Debt section.
- [x] The changelog and the roadmap carry the epic's receipt. Evidence:
      `docs/09-releases/CHANGELOG.md` and `docs/01-roadmap/ROADMAP.md`.
- [x] The epic exits with the required checks green. Evidence: the receipts and
      the local gates below.
- [x] The closure adds no code, and the documentation gates pass on it.
      Evidence: `pnpm format-check` and `git diff --check`.

## Domain Invariants

- **Closure follows evidence, not effort.**
- **A pending result is a result.** The criterion that asks for the run's
  outcome is satisfied by recording that it has not happened and why; it is
  never satisfied by silence.
- **`done` does not certify production.** The epic shipped the provider, the
  assembly, the events and the KuDE; it did not certify a tenant against the
  DNIT.
- **Deferred work stays visible.** No limitation recorded by a decision, a Story
  or a debt record is deleted or softened during closure.
- **The snapshot stays a snapshot.** The epic's pre-implementation sections are
  not rewritten to read as if they had always described the implemented state.

## API

### Added

```text
None. The closure documents the routes the epic's Stories ship.
```

## Database

### Migration

```text
None. The closure adds no migration; the schema carries 43, the last EPIC-16 one
being 20261013000001_fisc_012_cancel_pending_lease.
```

## UI

- None. The closure documents the surface the epic's Stories ship.

## Implementation Summary

The closure lands on `docs/epic-16-sifen-direct-closure`, cut from `main` after
every Story merged, and it contains documentation and evidence only:

- `docs/02-stories/FISC-014-epic-closure-and-evidence.md` — this Story.
- `docs/02-stories/FISC-013-contingency-and-homologation.md` — `status: done`,
  its exit criteria checked, and WU-D recorded as pending on the operator
  inputs.
- `docs/02-stories/FISC-015-the-document-assembly.md` — `status: done`, which it
  had been since PR #114 in everything but its frontmatter.
- `docs/01-roadmap/EPIC-16-SIFEN-Direct.md` — `status: done`, every acceptance
  and exit criterion checked, the limitation list extended, and the debt
  triaged.
- `docs/01-roadmap/ROADMAP.md` — the EPIC-16 row moved to `done` with the
  closure paragraph and the epic's receipts.
- `docs/09-releases/CHANGELOG.md` — the EPIC-16 entry.
- `docs/10-qa/CI-EVIDENCE.md` — the closure summary and the homologation's
  pending outcome.

## Verification

```text
The epic's merged receipts (one per Story, on the merged main):
  #104 b05d411  the kickoff
  #105 a6c0e3d  FISC-007 signing material
  #106 fc7f2fc  FISC-008 DTE XML
  #107 e1a29d7  FISC-009 XMLDSig
  #108 ffd08a1  FISC-011 timbrado and numbering
  #109 a87c9d9  bookkeeping
  #111 ff8954e  FISC-010 the DNIT web services
  #112 2bcef15  FISC-011 completion
  #113 4b9281b  FISC-012 the provider
  #114 a697a1f  FISC-015 the document assembly
  #115 7e6d081  FISC-016 the event family
  #116 a801cdf  TD-033 item 4
  #117 d6b1b69  FISC-013 WU-A the runbook
  #118 0522222  TD-033 item 5
  #119 d35c58e  FISC-013 WU-C the KuDE
  #120 718d201  TD-034   #121 18ad895  TD-035
  #122 441a069  TD-036   #123 deca629  TD-037

Local gates on the merged tree:
  database 26 files / 491 tests
  fiscal   34 files / 762 tests
  API      89 files / 1214 tests  (with DATABASE_URL_TEST: the live-PostgreSQL
           spec runs inside, 266 cases)
  worker   12 files / 163 tests
  web      90 files / 1087 tests
  pnpm lint / typecheck   -> 20/20, 20/20
  pnpm build              -> 12/12
  pnpm format-check       -> clean
  git diff --check        -> clean
```

The closure adds no code, so it adds no test: it verifies that the tests shipped
by the epic's Stories pass on the merged tree.

## Tests Added

- None. The closure verifies that the tests shipped by the epic's Stories pass,
  and adds none.

## Known Limitations

- **The certification/homologation run has not been performed.** WU-D's matrix
  needs the DNIT's habilitación (six operator steps), the test data set the DNIT
  hands over after step 2, and a certificate from a real PSC; the production CSC
  is issued at the emitter's `ingreso` and no deployment input carries it. Every
  synchronous, asynchronous, event, inutilización, KuDE and query row of the
  matrix is therefore **unrun**. This is the epic's largest honest limitation,
  and it is recorded rather than implied.
- **The receptor's four event payloads are missing** (five matrix rows): the
  emitter's two are built and signed, and `ajuste` has no published payload at
  all.
- **Three surfaces no Story owns** are needed by the run: the synchronous
  service (`receiveDe` exists in the facade and nothing calls it), a
  deliberate-invalid DE harness, and a batch composition of five documents of
  one type.
- **Contingency has no protocol.** The DNIT has not defined one; the flag is
  recorded and the question is named as the DNIT's.
- **A non-PYG invoice cannot be issued** (`F023` has no source), and a
  counter-path invoice is refused (`FISCAL_NUMBER_NOT_ALLOCATED`).
- **The KuDE's absences are real absences.** The signed DE carries only the
  items under `gDtipDE`, so the sale condition, the cuotas, the motive, the
  per-rate IVA settlement and the AFE's and the NRE's own blocks are not
  rendered — they are named instead. The two paper rolls are profiled and not
  rendered.
- **The city code, the alpha-2/alpha-3 country mismatch and `CatalogItem`'s
  missing code column** still refuse a remission note, an exterior operation and
  a customer with a stored country.
- **The worker's composition root is untested**, and `caPem` has no deployment
  input.
- **`done` is not production readiness.** [[EPIC-20]] Production Hardening
  remains, and the debt below is untouched.

## Technical Debt

Triaged here; **none resolved by this closure**.

- [[TD-028]] — `resolved` by FISC-012 WU-F (the reconciliation sweep).
- [[TD-029]] — `scheduled`: the operator-triggered re-drive, which needs a
  provider primitive rather than a local invention.
- [[TD-030]] — `scheduled`: EPIC-15's review advisories, several in the cancel
  and read paths this epic extends.
- [[TD-031]] — `open`: FISC-007's signing-material advisories.
- [[TD-032]] — `open`: FISC-008's DTE XML advisories.
- [[TD-033]] — `open`: FISC-016's event advisories — the re-drive reason, the
  lease sweep, and the XSD-gated signature round trip. Items 4 and 5 were fixed
  during this epic (#116, #118); the rest stay.
- [[TD-034]], [[TD-035]], [[TD-036]], [[TD-037]] — `done`: the KuDE renderer's
  four advisory rounds, eleven findings, none blocking. The last two fixes each
  removed code.
- [[TD-038]] — `resolved`, raised by this closure's own CI run: the schema
  gate's two copying cases inherited vitest's five-second default, which timed
  one out once. They now carry an explicit budget, and the record says what was
  measured rather than what was assumed.
- [[TD-022]] — `open`, not this epic's: the portal fiscal document surface.
- [[TD-026]] — `open`: unbounded list endpoints, which the new read surfaces
  must not worsen.

## Decisions / ADRs

- [[ADR-005]] — the tenant's signing material as RESTRICTED.
- [[ADR-006]] — XMLDSig rather than XAdES.
- [[ADR-007]] — the asynchronous outcome capability.
- [[ADR-008]] — the transport, mutual TLS and the parser.
- [[ADR-009]] — the port's request carries the signed document.
- [[ADR-010]] — the runtime XSD gate before submission.
- [[DEC-055]] — FISC-012's scope, the adapters, the QR and the reconciliation.
- [[DEC-056]] — the document assembly's missing inputs.
- [[DEC-057]] — the fiscal identity a DE needs.
- No ADR is required by the closure: it introduces no architecture change.

## Completion Notes

The Story is `done` and **EPIC-16 is `done`** by evidence-based closure. Every
acceptance and exit criterion is checked against a merged receipt or a recorded
limitation, the two stale Story statuses are corrected, and the debt is triaged
without resolving any of it.

**The honest headline is the run.** EPIC-16 built everything the certification
needs — the provider behind the port, the assembly, the events, the KuDE, the
signing material's custody, the XSD gate — and **it did not certify anything**,
because the certification is an operator act against the DNIT's own environment.
Anyone reading this epic's `done` as "SIFEN-ready" has read it wrong, and the
limitation list above is where that is stated.

The next work is the run itself, and it starts with an operator, not a commit.
