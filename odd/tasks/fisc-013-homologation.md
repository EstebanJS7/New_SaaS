# Feature: FISC-013 — contingency and the homologation run

**Branch**: `docs/epic-16-fisc-013-runbook` (from `main`) **Story**:
`docs/02-stories/FISC-013-contingency-and-homologation.md` **Baseline**:
`docs/06-fiscal/SIFEN-BASELINE.md` §11, §15, §18, §22.5, §23.7, §24, §25

## Goal

Turn the reviewed implementation into evidence: run the DNIT's own minimum test
matrix in the test environment and record the outcome, including a negative or
pending one. Its second half is contingency, and its honest finding is that the
DNIT has not defined a contingency protocol — so what this feature can do is
record the flag and name the pending question instead of inventing rules.

## What the sources pin, and what they do not

- **The habilitación is six steps** (S1, the DNIT's _Guía paso a paso_): the
  ticket, the DNIT's test data, access with the certificate, the minimum tests,
  the Form 364 v2 in Marangatu, and the notice plus the SET's approval in
  Marandú. Steps 1, 2, 5 and 6 are operator acts; steps 3 and 4 need the test
  data set, which only the DNIT hands over.
- **The matrix requires the events** — the cancellation 5 times and the
  inutilización 5 times, as the emitter — so the events are on this story's
  critical path and not optional. It also has four receptor rows and an "ajuste"
  row whose payload no event schema defines (baseline §25.9).
- **The contingency is empty by the DNIT's own admission.** Manual §14: «Se
  elimina el contenido de esta sección, ya que sigue en etapa de definición»,
  and the chapter is marked "Operación de Contingencia (Futuro)". The only
  contiguous fact is `dDesTipEmi = 2`, which the DE already carries.
- **The production CSC is issued at the emitter's `ingreso`** (Manual §13.8.1),
  and the test pair is generic — so the test CSC proves nothing about
  production, which is why the repository keeps the CSC per tenant **and per
  environment** ([[DEC-057]] Q3).

## The decisions this feature owns, and their state

| Decision                                 | State                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the CSC lives ([[DEC-057]] Q3)     | **Decided and half-built.** Per tenant and per environment, sealed in the secret store: `tenant_fiscal_csc`, `fiscal-csc.reader.ts`, read per document by the assembly. **No write surface exists** — the run cannot load the test pair through the API |
| Which environment the deployment targets | **Decided.** `SIFEN_ENVIRONMENT` ∈ {TEST, PRODUCTION}, required in production, resolved once by `resolveSifenEnvironment` and shared by both deployables; hosts `sifen-test.set.gov.py` / `sifen.set.gov.py`                                            |
| What the test data's placeholders are    | **Operator input, two exceptions.** The DNIT's reply supplies RUC, timbrado, validity, establishment and points; the two generic CSCs and the first item's description literal are fixed values (runbook §3)                                            |
| How the contingency flag is treated      | **Decided: record it and implement nothing.** `emissionType` 1/2 on the emitter profile reaches `iTipEmi`/`dDesTipEmi`; no timeout, queue or mode is invented, because DNIT has published no protocol                                                   |
| The emitter's name literal in test       | **Recorded discrepancy.** The Manual (§22.5) and the test guide print two different literals for the same field; the repository emits the Manual's (`emitterNameForEnvironment`) and waits for a refusal before changing it                             |

## Work units

- [x] **WU-A — the runbook and the decisions.** Landed 2026-10-13.
      `docs/06-fiscal/SIFEN-HOMOLOGATION-RUNBOOK.md`: the six steps with who,
      input, output and blocker each; the requirements checklist; the test
      data's shape including the two generic CSCs and the production one's
      provenance; the matrix as a runnable checklist with what the repository
      does per row and what blocks it; the four decisions with their state plus
      the gaps the run exposes (§5.5); what is pending from the DNIT; and the
      evidence's destination. The story's work units are pinned by this unit, as
      its own note anticipated.
- [x] **WU-B — the events.** Landed by [[FISC-016]], which profiled the family
      as its own WU-A (`SIFEN-BASELINE.md` §25) and built both emitter payloads,
      the signer, the cancellation through the provider and the inutilización's
      business surface. **What the matrix still needs and does not have is the
      receptor's four payloads** — recorded below as a blocked half.
- [ ] **WU-C — the KuDE.** The graphical representation, one per document type,
      with the QR pinned by §24. **Blocked on nothing but its own work**: the QR
      content builder (`dte.qr.ts`) and the CSC read exist.
- [ ] **WU-D — the run and its evidence.** **Blocked on the DNIT** (the
      habilitación and the test data set) and on the run blockers the runbook
      names: the CSC's registration surface, the batch composition, the
      synchronous and incorrect-data harnesses, the receptor events.

## Blocked halves, named

1. **The run** (WU-D) needs the DNIT: the test data set after step 2, and the
   habilitación's approval after step 6. No repository work substitutes for
   either.
2. **Two matrix rows need the KuDE** (WU-C): the graphical representation and
   the QR query, one and two per document type. The QR's composition is already
   pinned and built; the representation is not.
3. **Five of the matrix's scenarios need the receptor events**, and four
   payloads exist while the fifth scenario ("ajuste") has no published payload
   at all. This is either [[FISC-016]]'s scope grown or a story of its own; it
   is not this feature's.
4. **Three surfaces no story owns yet are needed by rows 3–6**: the synchronous
   service (`receiveDe` is in the facade and nothing calls it), a
   deliberate-invalid DE harness for the "incorrect data" rows, and a batch
   composition that puts five documents of one type in one lot (the adapter is a
   lot of one).
5. **The run cannot start without the CSC's write surface** — the read is
   implemented, the registration is not.

## Evidence log

```text
(pending)  docs(FISC-013): the homologation runbook, and the story's work units
           pinned (WU-A)
```

The line is owed by the parent orchestrator: this implementation unit does not
commit.

## Open

- **Contingency stays DNIT's.** The flag is recorded, the protocol is not
  implemented, and the story's exit criterion asks for exactly that.
- **The "WS Consulta" name** in the guide's authentication row cannot be mapped
  to a Manual service by any retrieved source; the run should ask the Mesa de
  ayuda (runbook §4.1, §6).
- **The event result codes** are uncoerced by design (baseline §25.5) and the
  run is the retrieval that will evidence them.
