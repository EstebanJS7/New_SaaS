---
id: HARD-004
type: story
title: "Operational recovery: runbook and an executed drill"
epic: EPIC-20
status: done
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
`backup`, `pitr`, `restore` or `wal_level` across the repository returns
nothing.

None of it can be _implemented_ here either. A backup schedule lives in a
hosting control plane, and this repository has no production environment. But
"recovery must be tested" is falsifiable here: PostgreSQL 16 binaries are
available at `/usr/lib/postgresql/16/bin`, and a disposable cluster can be
created, dumped and restored without Docker.

The distinction is the whole story: the repository owns the contract and the
rehearsal; the hosting provider owns the schedule.

## Acceptance Criteria

- [x] `docs/09-operations/BACKUP-RECOVERY.md` exists and states:
  - [x] the RPO target (≤ 24 h) as a requirement on the hosting provider;
  - [x] the PITR preconditions — WAL archiving enabled, an archive destination,
        a retention window — and what each one is for;
  - [x] the exact variables/settings a hosting provider must set;
  - [x] the restore procedure, step by step;
  - [x] **what this repository cannot verify**, in its own section;
  - [x] the trigger that requires re-running the drill.
- [x] A runnable drill script exists under `scripts/`, takes a backup from a
      disposable cluster, restores it into a second database, and asserts the
      restored database matches the source: applied migrations, a representative
      tenant-scoped row, and row counts for the sampled tables.
- [x] The drill is **executed** and its real output is recorded in the story and
      in the closure evidence block.
- [x] `/health/live` and `/health/ready` are recorded as evidence for PRD §30's
      first half, including the 503 behaviour when a dependency is down.
- [x] Structured logging with a request id is recorded as evidence, with the
      test that proves it named.
- [x] The drill does **not** enter the per-PR gate, and the reason is documented
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
- The drill is a script that can rot. The runbook names the trigger that forces
  a re-run; nothing enforces it automatically.

## Implementation summary

### What was delivered

```text
docs/09-operations/BACKUP-RECOVERY.md   the operational contract (new documentation area)
scripts/verify-restore-drill.sh          the executed drill
```

The split is the whole point. The runbook states the requirements on a hosting
provider — backup frequency, retention, off-site, encryption, RPO ≤ 24 h, the
four PITR settings, WAL retention outlasting the recovery window — and then
names, in its own section, what this repository cannot prove about any of them.
Three documents in this repository have already been corrected for asserting a
behaviour nobody verified, and a backup guarantee is the easiest such sentence
to write and the most expensive to be wrong about.

### The drill is TWO drills, because they answer two questions

```text
A  logical    pg_dump -> pg_restore into a SECOND, separate cluster.
              "Can we rebuild yesterday's state from a file?"

B  PITR       pg_basebackup + archived WAL, recovered to an instant BEFORE a
              write and to an instant AFTER it.
              "Can we land on a specific moment, and do we land on the RIGHT
               side of it?"
```

Direction B is what makes the second one a proof rather than a demonstration. A
restore that simply produced the newest available state would pass an "after"
assertion on its own; only the pair rules that out.

### The executed run, verbatim

```text

==> Prerequisites
    postgres 16.13 at /usr/lib/postgresql/16/bin
    work dir /tmp/newsaas-restore-drill
    PASS ports 55440, 55441, 55442 are free

==> DRILL A - logical backup and restore (pg_dump -> pg_restore)
    PASS source cluster up on 55440
    product schema applied (or skipped by request)
    source: 73 tables, 51 applied migrations, 66 permissions

==> DRILL A - taking the backup
    PASS pg_dump wrote 332824 bytes
    PASS source cluster stopped: the restored database is now the only one alive

==> DRILL A - restoring into a fresh database
    PASS pg_restore completed

==> DRILL A - checking the restored database
    PASS table count preserved: 73
    PASS applied migrations preserved: 51
    PASS seeded reference data preserved: 66 permissions
    PASS drill marker survived
    PASS restored schema is queryable

==> DRILL B - point-in-time recovery (pg_basebackup + WAL archive)
    PASS PITR source cluster up on 55442, WAL archiving to the archive dir

==> DRILL B - taking the base backup
WARNING:  skipping special file "./.s.PGSQL.55442"
WARNING:  skipping special file "./.s.PGSQL.55442"
    PASS pg_basebackup captured the cluster

==> DRILL B - writing the AFTER the target
    recovery target: 2026-10-22 13:47:19.392515+00
    archived WAL segments: 4

==> DRILL B - recovering to BEFORE the after-write
    rows present after recovery: 'before'
    PASS recovered to the target instant: the post-target row is ABSENT

==> DRILL B - recovering to AFTER the after-write
    recovery target: 2026-10-22 13:47:20.413424+00
    rows present after recovery: 'before,after'
    PASS recovered past the target instant: both real rows present, padding excluded

==> DRILL B - the recovered cluster is a promoted primary
    recovery_target_action = promote (the second recovery served reads, which a
    cluster still in recovery would refuse)

==> Summary
    DRILL A  logical backup and restore                    PASS
             73 tables, 51 applied migrations,
             66 permissions and the drill marker all survived a
             pg_dump -> pg_restore into a SECOND, separate cluster.

    DRILL B  point-in-time recovery                        PASS
             4 archived WAL segments recovered to an instant
             BEFORE the after-write (post-target row absent) and to an instant
             AFTER it (both rows present). The target time was honoured in both
             directions, which is what distinguishes PITR from "restore the
             newest thing you have".

    NOT PROVEN BY THIS SCRIPT
             That a hosting provider takes the backups, keeps the archive, honours
             an RPO of <= 24h, or retains WAL for the window the recovery target
             needs. Those are contractual and operational, not executable here.
             docs/09-operations/BACKUP-RECOVERY.md states them as requirements.

Restore drill PASSED.
```

### Four defects the drill found in itself

Each was a real failure of the script, not of PostgreSQL, and each is recorded
because the corrections are what make the output trustworthy.

1. **`recovery_target_time` quoted with an ISO `T`/`Z` value was rejected** with
   `invalid value for parameter "recovery_target_time"`. A `postgresql.conf`
   value is a GUC string whose parser is stricter than SQL's own timestamp
   input.
2. **Writing the same value unquoted** produced
   `syntax error … near token "-10"`, because a bare GUC value cannot contain
   `-`. The working form is the quoted `YYYY-MM-DD HH:MM:SS.ffffff+00`.
3. **A recovery target in the future is unreachable.** Recovering to wall-clock
   "now" failed with
   `recovery ended before configured recovery target was reached`, so the second
   direction now captures a target immediately after the real commit and writes
   a PADDING row so recovery has something to stop at.
4. **The target's exact boundary must not be an implementation detail.** With
   `recovery_target_inclusive` at its default, the assertion would have depended
   on whether the boundary transaction is applied. It is now pinned to `off`, so
   "before the target" means exactly the transactions strictly before the
   instant.

### Why the drill is not a per-pull-request gate

It needs a PostgreSQL server and three ports, and what it verifies changes only
when a migration or the dump format changes. Adding it to the PR path would
spend minutes of every review re-proving a stable fact. The runbook instead
names the trigger that forces a re-run: a migration that changes a table the
drill samples, a change to the script, a hosting change, or a release that
claims a recovery capability. This is [[DEC-074]]'s point 4, applied.

### PRD §30's first half, recorded rather than rebuilt

```text
/health/live             apps/api/src/health/health.controller.ts   + .test.ts
/health/ready            the same, with RedisHealthService and a 1500ms budget;
                         503 on degraded (cache only) or unhealthy (primary down)
structured logs          api-logger.factory.ts; request-id echoed on success and
                         error paths
request-id binding       error-envelope.integration.test.ts
                         "binds the request id to EVERY structured log line the
                          request produces"
log sanitization         the same suite: "never writes credential header values
                          into log lines"
no stack traces           global-exception.filter.ts + the 500 case that asserts
                          the body contains neither the marker nor the word "stack"
```

### Verification run

```text
bash scripts/verify-restore-drill.sh     exit 0, both drills PASS (output above)
bash -n scripts/verify-restore-drill.sh  syntax OK
pnpm --filter @newsaas/api test          1760 passed | 266 skipped  (health + logging evidence)
```
