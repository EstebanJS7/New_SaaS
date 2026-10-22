---
type: operations
status: active
owner: engineering
updated: 2026-10-22
---

# Backup and Recovery

PRD §30 requires, for the production database:

```text
automatic backups
PITR preferred
initial RPO target <= 24h
recovery must be tested
```

This document is the operational contract for those four. It is deliberately
split into **what a hosting provider must do** and **what this repository can
prove**, because conflating the two is how a repository ends up claiming a
recovery guarantee it does not have. [[DEC-074]] records that split as a
decision.

## The honest summary

**Proven here, on 2026-10-22**, by executing `scripts/verify-restore-drill.sh`
against PostgreSQL 16.13:

```text
logical backup and restore   PASS   pg_dump -> pg_restore into a SECOND cluster:
                                   73 tables, 51 applied migrations, 66 permissions
                                   and a drill marker all survived
point-in-time recovery       PASS   pg_basebackup + archived WAL, recovered to an
                                   instant BEFORE a write (that write ABSENT) and to
                                   an instant AFTER it (that write PRESENT)
```

**Not proven here, and not provable here:**

```text
that backups are taken on a schedule          hosting control plane
that the backup is off-site                    hosting control plane
that WAL is archived continuously              hosting control plane
that the archive is retained long enough       hosting control plane + contract
that an RPO <= 24h is actually met             a measurement in production, over time
that a restore completes in an acceptable RTO  a measurement against production volume
```

This repository has no production environment. Any sentence of the form "backups
run nightly and PITR is enabled" would be a claim about a system that does not
exist yet, and three documents in this repository have already been corrected
for making exactly that kind of unverifiable statement.

## Requirements on the hosting provider

These are contractual. A deployment that does not satisfy them is not covered by
this document.

### 1. Automatic backups

| Requirement           | Value                                        | Why                                                           |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| Backup frequency      | at least every 24 h                          | the RPO target below                                          |
| Backup type           | full physical base backup                    | restorable without the application                            |
| Retention             | ≥ 7 daily, ≥ 4 weekly                        | survives a defect noticed on a Monday                         |
| Off-site              | a different failure domain than the database | a region-local backup is not a backup                         |
| Encryption at rest    | required                                     | the database holds CONFIDENTIAL and RESTRICTED data (PRD §41) |
| Encryption in transit | required                                     | an unencrypted dump egress is a data-transfer incident        |

### 2. RPO target

**RPO ≤ 24 hours.** Stated as a target, not a guarantee: it is met only while
the backup schedule above holds. A deployment that wants a tighter RPO needs
continuous WAL archiving _and_ a shorter backup interval; 24 hours is the
initial target PRD §30 names.

### 3. PITR preconditions

Point-in-time recovery is **preferred** by PRD §30 and is what the second drill
proves. It only works when a deployment sets all of:

```text
wal_level              = replica      (the default in PostgreSQL 16; `logical` is not needed)
archive_mode           = on
archive_command        = a command that copies %p to durable, off-host storage
                          and MUST NOT overwrite an existing file
archive_timeout        = 300          caps the window on a quiet database
```

The drill verifies these mechanics with a local `archive_command` that copies
into a directory. In production the archive destination must be object storage
or a block volume in a different failure domain — never the database host,
because the recovery point must survive the loss of that host.

**WAL retention must outlast the recovery window.** A recovery target older than
the archive's earliest retained segment is unreachable, and the failure appears
only when someone needs it. The archive must retain at least the same window as
the backups (≥ 7 days adopted here).

### 4. Restore target

Not specified by PRD §30 and **not measured**. A restore of the drill-sized
database takes seconds; a restore of a real tenant's data plus its WAL replay
does not, and nobody has measured the second. Treat the RTO as unknown until a
restore is timed against production-sized data.

## The drill

```bash
bash scripts/verify-restore-drill.sh
```

It needs PostgreSQL 16 client and server binaries (`PG_BIN`, default
`/usr/lib/postgresql/16/bin`), no Docker, no network, no elevated privileges. It
creates everything under a temporary directory and removes it afterwards
(`DRILL_KEEP=1` keeps it for inspection).

### What it does, and why each step is there

**Drill A — logical backup and restore**

```text
1. initdb a disposable cluster, apply the REPOSITORY's migrations and seed through
   `pnpm --filter @newsaas/database db:deploy` / `db:seed`
   -> a drill that restored an empty database would prove the tooling and nothing
      about the product
2. write a marker row the drill owns
   -> its survival distinguishes "the restore worked" from "a database exists"
3. pg_dump -Fc
4. STOP the source cluster
   -> nothing the drill reads afterwards can come from the original by accident
5. pg_restore into a fresh database on a SECOND cluster
   -> a restore sharing a cluster with its origin proves less; a real recovery
      lands on different hardware
6. compare table count, applied-migration count, seeded row count, and read the
   marker back
```

**Drill B — point-in-time recovery**

```text
1. initdb with wal_level=replica, archive_mode=on, archive_command -> archive dir
2. apply the schema, write marker 'before'
3. pg_basebackup -X stream
4. record T1, write marker 'after', record T2, write a PADDING row, switch WAL
   -> a recovery can only stop at a target it can REACH; without a commit after
      T2 PostgreSQL refuses with "recovery ended before configured recovery target
      was reached". recovery_target_inclusive = off then keeps the padding out of
      the recovered state, so the assertion stays exact.
5. recover the base backup + archived WAL to T1 -> expect ONLY 'before'
   -> THIS is the assertion that proves the target time was honoured. A restore
      that simply produced the newest state would show 'before,after' here.
6. recover the same base backup to T2 -> expect 'before,after' (padding excluded)
   -> the opposite direction, so a run that ignored the target and always replayed
      everything cannot pass both.
```

### What the drill deliberately does not do

- **It does not touch any database it did not create.** It refuses to start if
  one of its ports is already serving PostgreSQL, so a misconfigured run fails
  instead of connecting to something real.
- **It does not run in CI's per-pull-request path.** It needs a PostgreSQL
  server and three ports, and what it verifies changes only when a migration or
  the dump format changes. Running it on every pull request would add minutes to
  every review to re-prove a stable fact.
- **It does not test the production archive's retention.** That is a contract
  with the provider, not something a script here can observe.

### When the drill must be re-run

- **Any migration that changes a table the drill samples.** The counts are read
  from the applied schema; a migration that adds a table changes the expected
  number and the drill must be re-run to keep the number honest rather than
  stale.
- **Any change to `scripts/verify-restore-drill.sh` itself.**
- **Any hosting change** to the backup schedule, the archive destination, or the
  PostgreSQL major version.
- **Before any release that claims a recovery capability** to a customer or in a
  contract.

The result of the last run belongs in `docs/10-qa/CI-EVIDENCE.md`, with the date
and the counts — a drill result without a date is a claim about the past that
nobody can date.

## Health and logging (PRD §30, first half)

PRD §30's other half is code and already exists. Recorded here so the
operational view is complete:

```text
/health/live     200 while the process is up; no dependency is consulted
                 -> an orchestrator must NOT restart on readiness failure
/health/ready    200 healthy; 503 degraded (cache tier only) or unhealthy (a
                 primary dependency down), each under a 1500ms per-dependency budget
                 -> an orchestrator removes the instance from rotation on 503
structured logs  pino, one line per request with a request id, echoed on success
                 AND error responses; cookie and credential values are redacted and
                 a 5xx response carries a generic message while the diagnostic stays
                 server-side, bound to the same request id
```

The probes are anonymous by contract, which is why they are the two routes that
opt out of the global authentication guard — a load balancer has no session.
