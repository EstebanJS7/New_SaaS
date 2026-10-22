---
id: DEC-074
type: decision
title:
  EPIC-20 splits PRD §29/§30 into code this repository owns and an operational
  runbook it can only describe and rehearse
status: accepted
date: 2026-10-22
related_epics:
  - "EPIC-20"
related_decisions: []
related_stories:
  - "HARD-004"
  - "HARD-007"
prd_change_required: false
---

# DEC-074 — What hardening is code, what is a runbook, and how a restore is proven

## Context

PRD §29 lists eleven required controls. PRD §30 is two paragraphs, and the two
are not the same kind of thing:

```text
§30 first half    structured logs with request ID; /health/live and /health/ready
                  -> code, running in this repository, provable by a test

§30 second half   automatic database backups; PITR preferred; initial RPO target
                  <= 24h; recovery must be tested
                  -> a hosting control plane, not a Node process
```

No amount of code in this repository starts a backup job. Conversely, "recovery
must be tested" is a claim that **can** be falsified here even when the
production backup job cannot: a restore procedure either works when executed or
it does not, and the `pg_dump`/`pg_restore` toolchain is available in this
environment (PostgreSQL 16 binaries at `/usr/lib/postgresql/16/bin`, no Docker).

The repository also has no production environment, so any sentence of the form
"backups are taken daily and PITR is enabled" would be an assertion about a
system that does not exist. This repository has been bitten three times already
by documents claiming something false — a test that did not exist, a retention
that did not happen, a CSV sample that did not match its contract — and the
closure ritual that follows is explicit that every claim must be verifiable.

## Question

Which parts of PRD §30 does EPIC-20 deliver as code, which as a written
procedure, and what counts as evidence for the part that is neither?

## Options

**A. Only code.** The epic delivers CSP, CORS verification, shared rate limits,
shared storage and observability, and files backups/PITR/RPO as a Tech Debt
attributed to hosting. Nothing in the repository describes a recovery procedure
and nothing is rehearsed.

**B. Code plus a written runbook, never executed.** The epic adds
`docs/09-operations/BACKUP-RECOVERY.md` describing the hosting requirements, the
RPO target and the restore steps, and states plainly that the restore was never
run. A Tech Debt with the trigger "first production environment" carries it.

**C. Code plus a written runbook plus an executed drill.** Same document, plus a
runnable script that takes a backup from a disposable cluster, restores it into
a second database, and verifies the restored schema and a known row count. The
drill is executed during the epic and its real output is pasted into the
evidence block.

**D. C, but the drill runs once and is not a repeatable gate.** Same
deliverable, the output recorded, and the drill explicitly not wired into any CI
job.

## Decision

**C.**

1. **PRD §30's first half is code and is already partly delivered.**
   `/health/live` and `/health/ready` exist with a Redis probe under a 1500 ms
   per-dependency budget, and structured pino logs already carry a request id,
   echoed on both success and error responses. The epic verifies and records
   these; it does not rebuild them.
2. **PRD §30's second half is a runbook this repository owns.** This repository
   is where the deployment lives, so it is where the operational contract
   belongs: an explicit RPO target, the PITR preconditions (WAL archiving,
   retention window, `restore_command`), and the drill procedure.
   `docs/09-operations/` is that home.
3. **The restore is executed, and the evidence is the output.** A runbook step
   that has never run is a hypothesis. `scripts/verify-restore-drill.sh` takes a
   dump from a disposable PostgreSQL 16 cluster, restores it into a second
   database, and asserts: the migration table has every applied migration, a
   representative tenant-scoped row survives, and the row counts match the
   source. The script's real output is recorded in the closure block.
4. **The drill does not enter the PR gate.** It needs a PostgreSQL cluster and a
   second database, and the CI `Database migrations` job already provisions one
   for its own purposes; adding a _restore_ to the per-PR path would slow every
   pull request to re-prove something that changes only when a migration or the
   dump format changes. It runs when claimed, and the claim is recorded with its
   output. This is a deliberate repetition cost, not an unpaid one: the runbook
   names the trigger (a migration that changes a table the drill samples, or any
   hosting change).
5. **The closure statement separates the two halves in words.** It says which
   controls were proven by a test in this repository and which rest on an
   operational contract with a rehearsed drill. It does not say "production
   ready" about anything a hosting provider owns.

## Consequences

- The epic can state something stronger than its predecessors about §30:
  "recovery was rehearsed and its output is recorded" is verifiable, "recovery
  will work in production" is not.
- A single sentence of the epic's closure carries the whole limitation: the
  production backup job, its schedule, its retention and the PITR window are
  hosting configuration, and the repository can only state the requirement and
  rehearse the procedure against them.
- The drill is a script that can rot. The mitigation is the trigger in the
  runbook rather than a hope that someone reruns it.
- `docs/09-operations/` becomes a new documentation area. It is a new directory,
  not a new runtime, so no ADR is required.
