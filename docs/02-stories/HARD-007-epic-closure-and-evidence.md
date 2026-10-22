---
id: HARD-007
type: story
title: The epic closure and evidence
epic: EPIC-20
status: planned
priority: high
depends_on:
  - HARD-001
  - HARD-002
  - HARD-003
  - HARD-004
  - HARD-005
  - HARD-006
prd_sections:
  - "29"
  - "30"
permissions: []
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# HARD-007 — The epic closure and evidence

## Objective

Close [[EPIC-20]] the way [[EPIC-19]] was closed: a criterion-to-evidence map
against PRD §29 and §30, a real CI run id, the changelog, the roadmap row, the
module documentation and a triage of everything the epic did not do.

## Context

Every epic in this chain closed with the sentence "this is **never** production
readiness". This is the epic whose whole purpose is to earn the right to stop
repeating it — and the honest answer is that it can earn it for the half that is
code, and cannot for the half that is a hosting control plane.

The closure must therefore say something more precise than either extreme:

- §29 is **proven**: every control has a test in this repository that fails if
  the control is removed.
- §30's first half is **proven**: health probes and request-id logging have tests.
- §30's second half is **rehearsed**: the restore drill ran and its output is
  recorded, and the backup schedule, retention and PITR window remain hosting
  obligations that this repository states and cannot verify.

## Acceptance Criteria

- [ ] A criterion-to-evidence map covers every bullet of PRD §29 and both halves
      of PRD §30, naming the test or artifact that proves each one.
- [ ] Two PRD §29 bullets are recorded as **already satisfied before this epic**
      (CORS, no stack traces), with their evidence, rather than claimed as new
      work.
- [ ] The live-PostgreSQL lane is executed and its case count recorded.
- [ ] The browser lane is executed and its pass/skip counts recorded exactly,
      including whether any skip attributable to [[TD-060]] remains.
- [ ] The restore drill's real output is in the evidence block.
- [ ] `docs/10-qa/CI-EVIDENCE.md` gains an EPIC-20 block with the **real** CI run
      id and each required job's result.
- [ ] The roadmap row moves to `done` with a closure statement that separates
      what was proven from what is an operational contract.
- [ ] The changelog records the epic.
- [ ] Module documentation is current: the auth module's rate-limit section, the
      storage module's environment contract, and the new operations area.
- [ ] Debt triage: each of [[TD-005]], [[TD-060]], [[TD-054]], [[TD-021]],
      [[TD-015]], [[TD-003]], [[TD-053]], [[TD-056]] is `resolved` with a link to
      its resolving commit, or explicitly still open with a reason.
- [ ] Each of [[TD-020]], [[TD-026]], [[TD-051]], [[TD-058]] carries a recorded
      reason for remaining open and a trigger.
- [ ] `pnpm format-check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`
      green on the closing tree, with the totals recorded.

## Verification

```text
pnpm format-check && pnpm lint && pnpm typecheck && pnpm build && pnpm test
gh pr create --base main          (the only thing that triggers CI)
```
