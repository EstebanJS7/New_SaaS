---
feature: FISC-014 — EPIC-16's closure
branch: docs/epic-16-sifen-direct-closure
created: 2026-10-15
status: in-progress
---

# FISC-014 — EPIC-16's closure

## Goal

Close [[EPIC-16]] SIFEN Direct **against evidence**: the closure story, the
module record, the QA evidence, the changelog, the roadmap, the story
reconciliation and the advisory triage — and **never** a production-readiness
claim.

## What the sources pin, and what they do not

- **The epic lists FISC-014 as a Story** ("Epic closure: module docs, CI
  evidence, changelog, roadmap, advisory triage") **but no story file exists**.
  The precedent is `BILL-005-epic-closure-and-evidence.md`, so the first step is
  creating `docs/02-stories/FISC-014-epic-closure-and-evidence.md`.
- **The homologation run (FISC-013 WU-D) has not happened.** The epic's own
  acceptance criterion admits it: "The certification/homologation run is
  recorded as evidence, **or explicitly recorded as not yet performed**", and
  FISC-013's exit criteria admit "a negative **or pending** result". So the
  closure records it as pending and names the three operator inputs that block
  it: the DNIT's habilitación, a certificate from a real PSC, and the production
  CSC.
- **A closure follows evidence, not effort.** Every criterion is checked only
  when its named evidence exists and is merged.

## The epic's receipts

| PR   | merge     | Story                                     |
| ---- | --------- | ----------------------------------------- |
| #104 | `b05d411` | the kickoff                               |
| #105 | `a6c0e3d` | FISC-007 signing material                 |
| #106 | `fc7f2fc` | FISC-008 DTE XML                          |
| #107 | `e1a29d7` | FISC-009 XMLDSig                          |
| #108 | `ffd08a1` | FISC-011 timbrado and numbering           |
| #109 | `a87c9d9` | bookkeeping                               |
| #111 | `ff8954e` | FISC-010 the DNIT web services            |
| #112 | `2bcef15` | FISC-011 completion                       |
| #113 | `4b9281b` | FISC-012 the provider                     |
| #114 | `a697a1f` | FISC-015 the document assembly            |
| #115 | `7e6d081` | FISC-016 the event family                 |
| #116 | `a801cdf` | TD-033 item 4 (the caller's abort signal) |
| #117 | `d6b1b69` | FISC-013 WU-A (the runbook)               |
| #118 | `0522222` | TD-033 item 5 (the cancel lease)          |
| #119 | `d35c58e` | FISC-013 WU-C (the KuDE)                  |
| #120 | `718d201` | TD-034                                    |
| #121 | `18ad895` | TD-035                                    |
| #122 | `441a069` | TD-036                                    |
| #123 | `deca629` | TD-037                                    |

**FISC-006** closed 2026-10-03 as the epic's precondition.

## The state the closure must record

- **Story statuses to reconcile**: FISC-013 is `in-progress` and belongs at
  `done` once the pending run's outcome is recorded; **FISC-015 is `planned` and
  landed as PR #114** — a stale status the closure fixes.
- **The schema carries 43 migrations**; the last EPIC-16 one is
  `20261013000001_fisc_012_cancel_pending_lease`.
- **Debt, by status**: TD-028 `resolved`; TD-029 and TD-030 `scheduled`; TD-031,
  TD-032 and TD-033 `open`; TD-034 through TD-037 `done`; TD-022 and TD-026
  `open` and not this epic's to resolve.

## Steps

- [x] Create `docs/02-stories/FISC-014-epic-closure-and-evidence.md`
- [x] Reconcile the story statuses (FISC-013 at `done` with WU-D recorded as
      pending; FISC-015 at `done`, which it had been since PR #114 in everything
      but its frontmatter)
- [x] Update `docs/01-roadmap/EPIC-16-SIFEN-Direct.md` — status, criteria, a
      Closure section, a Limitations section and the debt triage
- [x] Update `docs/01-roadmap/ROADMAP.md` — the row and the closure narrative
- [x] Add the closure entry to `docs/09-releases/CHANGELOG.md`
- [x] Add the epic-closure section to `docs/10-qa/CI-EVIDENCE.md`, including the
      homologation's **pending** outcome
- [x] Bring `docs/05-modules/Fiscal.md` current: it still said the provider, the
      signing and the KuDE rendering were _not_ owned, that the worker could not
      build a document, and that two named tests were failing when both had been
      fixed. Added the KuDE section and the test counts
- [x] Verify: `pnpm format-check`, `git diff --check`, and the gates on the
      merged tree

## Blocked halves, named

1. **The homologation run** needs the DNIT: its habilitación, the test data set
   it hands over, and the production CSC issued at the emitter's `ingreso`.
2. **The receptor's four event payloads** (five matrix rows) are still missing.
3. **Three surfaces no story owns**: the synchronous service, a
   deliberate-invalid harness, and a batch composition of five documents.

## Evidence log

```text
(pending)  docs(FISC-014): the closure story, and EPIC-16 closed against
           evidence with the run recorded as pending
```
