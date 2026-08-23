---
id: TD-002
type: tech-debt
title: Capture executable PowerShell preflight evidence
status: open
severity: medium
related_epics:
  - EPIC-00
related_stories:
  - FOUND-005
created: 2026-08-23
updated: 2026-08-23
---

# TD-002 — Capture executable Windows preflight evidence

## Context

The EPIC-00 closeout change (`openspec/changes/epic-00-closeout-and-archive/`)
requires executing `infra/scripts/preflight.ps1` through a real runtime and
recording the five-scenario result matrix (success; CLI not built; invalid port;
PostgreSQL unreachable; Redis unreachable) in
`docs/10-qa/PREFLIGHT-EVIDENCE.md`.

At apply time (2026-08-23) this could not be performed:

- PowerShell 7 (`pwsh`) is not installed locally;
- the only available runtime is Windows PowerShell 5.1 (via WSL interop);
- `infra/scripts/preflight.ps1` declares `#Requires -Version 7.2`, so 5.1
  refuses to run it before any logic executes.

This record was created under the maintainer authorization of 2026-08-23 that
deferred closeout Slice 2 to Tech Debt instead of blocking archive.

## Debt

The Windows preflight path has defined scenarios but no captured execution
evidence, so parity between `preflight.sh` and `preflight.ps1` remains claimed
rather than proven.

## Why It Is Safe to Defer

The POSIX preflight (`infra/scripts/preflight.sh`) was executed successfully
during EPIC-00 verification with live Compose probes (PostgreSQL persistence,
Redis reachability, named non-zero failures), recorded in
`openspec/changes/epic-00-foundation/verify-report.md`. The `.ps1` script is a
developer-convenience entry point, not part of any runtime or CI gate. No
application invariant depends on it.

## Risk

Windows contributors may hit untested failures in `preflight.ps1` (encoding,
path, or version-specific behavior). Likelihood low, impact limited to local
developer onboarding on Windows.

## Evidence Gate

Resolution requires one of:

- a completed five-scenario result matrix (exit code + output per scenario) in
  `docs/10-qa/PREFLIGHT-EVIDENCE.md`, produced by actually running the script;
  or
- a documented Windows CI fallback job that runs the same matrix and whose green
  runs are referenced from that file.

If PS7 stays unavailable locally and the version floor is relaxed instead, the
relaxation must be justified empirically: every scenario must pass on the
lowered runtime before committing the change.

## Proposed Resolution

1. Preferred: install PowerShell 7.2+ locally, run the scenario matrix, and
   record results in `docs/10-qa/PREFLIGHT-EVIDENCE.md`.
2. Alternative: add a Windows runner job in CI executing the matrix and link its
   evidence from `docs/10-qa/PREFLIGHT-EVIDENCE.md`.
3. Only as a last resort: relax the `#Requires` floor after all five scenarios
   pass empirically on the highest available runtime.

## Trigger / Target

When PowerShell 7.2+ becomes available locally, or when the first Windows-first
contributor joins — whichever comes first. Must be resolved before the Windows
developer-onboarding experience is declared supported.

## Verification After Resolution

- [ ] Five-scenario matrix executed with exit codes and output captured.
- [ ] `docs/10-qa/PREFLIGHT-EVIDENCE.md` records the runtime used and results.
- [ ] This record closed with a link to the evidence commit.
