# Change Notes — Maintainer Scope Authorization

## Authorization record

- **Date**: 2026-08-23
- **Authority**: repository maintainer (interactive apply session)
- **Decision**: implement Slice 3 (worker signal-shutdown tests) and Slice 4
  (DEC-001, EPIC-00 reconciliation) only.
- **Deferred**: Slice 1 (GitHub branch-protection verification/configuration)
  and Slice 2 (executable PowerShell preflight evidence).
- **Why**: at apply time `gh` is absent and no repository-admin/API authority
  exists for Slice 1; only Windows PowerShell 5.1 is available while
  `infra/scripts/preflight.ps1` declares `#Requires -Version 7.2`, so Slice 2
  cannot produce executable evidence locally.
- **Completion action**: each deferred slice is recorded as an explicit Tech
  Debt item with evidence gate and re-entry conditions:
  `docs/08-tech-debt/TD-001-branch-protection-verification.md` and
  `docs/08-tech-debt/TD-002-preflight-execution-evidence.md`.

## Archive eligibility exception

Per tasks.md Unit 5.2 and the maintainer authorization above, archiving this
change with Slices 1–2 deferred is an explicitly authorized exception. The
deferral is documented in TD-001/TD-002 and in EPIC-00 Implementation Notes; it
must never be presented as completed work.

## Apply summary (2026-08-23)

- Unit 1: `apps/worker/src/main.ts` extracted exported
  `installSignalShutdown(handle, proc)`; added missing `.catch` on shutdown
  promise (log + exit 1); entry point delegates to installer.
  `apps/worker/src/main.test.ts` covers SIGTERM/SIGINT → exit 0, second-signal
  inertness, rejection → logged + non-zero exit, via EventEmitter-backed stub
  and spied `exit`; no child processes.
- Unit 2: TD-001 and TD-002 created under `docs/08-tech-debt/`.
- Unit 3: DEC-001 created under `docs/07-decisions/`, status `proposed`
  (acceptance is a human gate).
- Unit 4: `docs/01-roadmap/EPIC-00-Foundation.md` reconciled with evidence
  links; deferred slices recorded as limitations.
- Unit 5: NOT executed by this apply run (orchestrator-gated).
