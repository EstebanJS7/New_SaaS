---
id: HARD-004
type: story
title: "Operational recovery: runbook and an executed drill"
epic: EPIC-20
status: planned
priority: high
depends_on: []
prd_sections:
  - "30"
permissions: []
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# HARD-004 — Operational recovery: runbook and an executed drill

## Objective

Deliver PRD §30's second half as far as this repository can honestly deliver it:
a runbook that states the hosting requirements, the RPO target and the PITR
preconditions, plus a **restore drill that is executed**, with its real output
recorded. [[DEC-074]] fixes what is code, what is procedure, and what counts as
evidence.

## Context

PRD §30 requires automatic backups, PITR preferred, an initial RPO ≤ 24 h, and
that "recovery must be tested". None of it exists in any form: a search for
`backup`, `pitr`, `restore` or `wal_level` across the repository returns nothing.

None of it can be *implemented* here either. A backup schedule lives in a hosting
control plane, and this repository has no production environment. But "recovery
must be tested" is falsifiable here: PostgreSQL 16 binaries are available at
`/usr/lib/postgresql/16/bin`, and a disposable cluster can be created, dumped and
restored without Docker.

The distinction is the whole story: the repository owns the contract and the
rehearsal; the hosting provider owns the schedule.

## Acceptance Criteria

- [ ] `docs/09-operations/BACKUP-RECOVERY.md` exists and states:
  - [ ] the RPO target (≤ 24 h) as a requirement on the hosting provider;
  - [ ] the PITR preconditions — WAL archiving enabled, an archive destination,
        a retention window — and what each one is for;
  - [ ] the exact variables/settings a hosting provider must set;
  - [ ] the restore procedure, step by step;
  - [ ] **what this repository cannot verify**, in its own section;
  - [ ] the trigger that requires re-running the drill.
- [ ] A runnable drill script exists under `scripts/`, takes a backup from a
      disposable cluster, restores it into a second database, and asserts the
      restored database matches the source: applied migrations, a representative
      tenant-scoped row, and row counts for the sampled tables.
- [ ] The drill is **executed** and its real output is recorded in the story and
      in the closure evidence block.
- [ ] `/health/live` and `/health/ready` are recorded as evidence for PRD §30's
      first half, including the 503 behaviour when a dependency is down.
- [ ] Structured logging with a request id is recorded as evidence, with the test
      that proves it named.
- [ ] The drill does **not** enter the per-PR gate, and the reason is documented
      rather than implied.

## Verification

```text
bash scripts/verify-restore-drill.sh      # executed, output recorded
pnpm --filter @newsaas/api test           # health + logging evidence
pnpm format-check && pnpm lint && pnpm typecheck
```

## Technical Debt / Limitations

- The production backup job, its schedule, its retention and the PITR window are
  hosting configuration. The repository states the requirement and rehearses the
  procedure; it cannot prove the provider honours either.
- The drill is a script that can rot. The runbook names the trigger that forces a
  re-run; nothing enforces it automatically.
