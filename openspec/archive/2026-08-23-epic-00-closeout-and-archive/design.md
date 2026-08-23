# Design: EPIC-00 Closeout and Archive

Operational closeout — no new layers or abstractions. Four independently
verifiable slices; archive happens only after every gate is green or its blocker
is explicitly recorded. Design-time probes confirmed: `gh` CLI is absent; the
only PowerShell runtime is Windows PowerShell 5.1 (script declares
`#Requires -Version 7.2`, so direct execution will hit the version gate).

## Slice 1 — GitHub branch protection (`main`)

- **Approach**: At apply time probe tooling: `command -v gh` + `gh auth status`.
  If available, inspect read-only first:
  `gh api repos/{owner}/{repo}/branches/main/protection`. Required check
  `Lint, Typecheck, Test, Build` (job id `quality`, already defined in
  `.github/workflows/ci.yml`) is configured ONLY by a repository administrator.
  Current reality: `gh` unavailable ⇒ record blocker; make no merge-blocking
  claim.
- **Files**: `docs/10-qa/CI-EVIDENCE.md` (record verified outcome OR explicit
  blocker + retry path). Workflow unchanged.
- **Verify**: Protection API response listing the required check (evidence quote
  in CI-EVIDENCE.md); otherwise blocker paragraph naming missing authority. This
  is an **evidence gate**, never silently skipped.
- **Rollback**: Policy restore exclusively via authorized admin; doc revert is a
  plain git revert.

## Slice 2 — Executable PowerShell preflight evidence

- **Approach**: Probe runtimes in order: `pwsh` → `pwsh.exe` → `powershell.exe`
  (WSL interop,
  `-NoProfile -ExecutionPolicy Bypass -File C:\NewSaaS\infra\scripts\preflight.ps1`).
  Contingency ladder: (a) PS7 found → run directly; (b) only 5.1 → the
  `#Requires -Version 7.2` gate refuses before any logic; script body contains
  no PS7-only syntax, so lower the floor to the highest version that passes ALL
  five scenarios empirically; (c) still failing → documented Windows CI fallback
  job (spec scenario already covers this).
- **Files**: `infra/scripts/preflight.ps1` (conditional: version-floor relax
  only), `docs/10-qa/PREFLIGHT-EVIDENCE.md` (new; compact result matrix).
- **Verify**: Execute the scenario matrix, capturing exit code + output: success
  (exit 0); CLI not built; invalid port (named); PostgreSQL unreachable; Redis
  unreachable (toggle services via `pnpm services:up/down` / compose stop).
- **Rollback**: Revert script/evidence commits; no persistent infra state
  mutated.

## Slice 3 — Worker SIGTERM/SIGINT graceful-shutdown tests

- **Approach**: Extract the inline handler block in `apps/worker/src/main.ts`
  into an exported, injectable installer (see Interfaces). Fix the existing gap:
  `handle.shutdown().then(() => process.exit(0))` has NO `.catch`, so a
  rejection becomes an unhandled rejection instead of the spec-mandated logged
  failure + non-zero exit. Add explicit `.catch`: log via `console.error`, exit
  `1`. Entry point delegates to the installer. Unit-test all four spec scenarios
  with an `EventEmitter` stub + spied `exit`; no child-process spawns
  (slow/flaky, exceeds review budget).
- **Files**: `apps/worker/src/main.ts` (modify), `apps/worker/src/main.test.ts`
  (modify).
- **Verify**: `pnpm test --filter @newsaas/worker`; scenarios: SIGTERM→exit 0;
  SIGINT→exit 0; second signal after first does NOT re-run shutdown (listeners
  removed), exit stays 0; shutdown rejects → non-zero + logged.
- **Rollback**: Revert commit; entry-point behavior returns to current state.

## Slice 4 — Decision, EPIC-00 reconciliation, final verification, archive

- **Approach**: Create
  `docs/07-decisions/DEC-001-documentation-authority-and-openspec-trace.md` from
  `docs/_templates/DECISION.md`, `status: proposed` (maintainer accepts):
  `docs/` is the permanent source of truth; `openspec/changes/*` are temporary
  SDD trace; archive trigger = all closeout gates verified AND blockers resolved
  (answers the proposal question round). Then reconcile
  `docs/01-roadmap/EPIC-00-Foundation.md`: tick criteria with evidence links
  (CI-EVIDENCE, PREFLIGHT-EVIDENCE, worker tests, DEC-001), fill Implementation
  Notes, bump `updated`. Run full root gates. Archive LAST.
- **Files**: `docs/07-decisions/DEC-001-…md` (create),
  `docs/01-roadmap/EPIC-00-Foundation.md` (modify),
  `openspec/changes/epic-00-closeout-and-archive/` → moved to
  `openspec/archive/<YYYY-MM-DD>-epic-00-closeout-and-archive/` (move, audit
  trail preserved).
- **Verify**:
  `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`
  (per `openspec/config.yaml` verify rules). Archive precondition checklist:
  slices 1–3 evidenced (or Slice-1 blocker formally accepted), Decision
  accepted, EPIC reconciled. Any unmet item ⇒ NO archive; record remainder in
  change state.
- **Rollback**: Docs are additive; un-archive = move folder back; nothing
  destructive.

## Execution order & dependencies

    Slice 1 (probe/verify/blocker) ─┐
    Slice 2 (preflight evidence)  ──┼──▶ Gate check ──▶ Final full gates ──▶ Archive (LAST)
    Slice 3 (worker signals)      ──┤        │
    Slice 4a: DEC-001 proposed ◀───┘        └─ any red/unresolved ⇒ no archive,
    Slice 4b: EPIC reconcile needs 1–3 outcomes                 record in change state

Slices 1–3 are independent; Slice 4 consumes their outcomes. Archive is strictly
terminal and gated.

## Architecture Decisions

| Option                                                                     | Tradeoff                                                                                                               | Decision                                                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Signal wiring: inline vs extracted installer                               | Extraction adds one export; enables deterministic vitest coverage of OS-signal paths                                   | Extract `installSignalShutdown(handle, proc)`                               |
| Shutdown failure: explicit `.catch` vs rely on unhandled-rejection default | Default is Node-version-dependent and unlogged; spec demands log + non-zero                                            | Explicit `.catch` → `console.error` + exit 1                                |
| PowerShell runtime: force PS7 vs adapt floor vs CI fallback                | Forcing PS7 blocks on this machine; floor relax touches one line after empirical proof; fallback delays evidence to CI | Probe PS7 → conditional floor relax (all scenarios must pass) → CI fallback |
| Decision status at creation                                                | Accepting it ourselves would bypass maintainer authority                                                               | Create `proposed`; acceptance is a human gate before archive                |

## Data Flow (shutdown sequence)

    SIGTERM/SIGINT ──▶ installSignalShutdown ──▶ handle.shutdown()
                          (dedup: off/once)           │
                                                app.close() → Nest lifecycle
                                                → Redis disconnect
                                                      │
                                        resolve ──▶ exit(0)
                                        reject  ──▶ console.error ──▶ exit(1)

## Interfaces / Contracts

```typescript
// apps/worker/src/main.ts
export function installSignalShutdown(
  handle: WorkerHandle,
  proc: Pick<NodeJS.Process, "once" | "off" | "exit"> = process
): void;
```

Behavioral contract (tested): first signal removes both listeners, awaits
`handle.shutdown()`, exits 0; rejection logs and exits 1; second signal is
inert.

## Testing Strategy

| Layer                         | What                                          | How                                           |
| ----------------------------- | --------------------------------------------- | --------------------------------------------- |
| Unit                          | 4 signal scenarios + existing bootstrap cases | Vitest, fake emitter + spied `exit`           |
| Integration (manual evidence) | Preflight 5-scenario matrix                   | Real `powershell.exe` runs, captured output   |
| Process/E2E                   | Full root gates                               | `pnpm lint/format-check/typecheck/test/build` |
| Governance                    | Archive eligibility                           | Checklist over slices 1–4 evidence            |

## Threat Matrix

N/A — no routing, shell-execution, subprocess, VCS/PR automation, or
executable-file classification boundary is added to product code. Worker signal
handling is process-lifecycle behavior covered above; preflight invocation is
manual evidence collection outside the runtime.

## Migration / Rollout

No migration. Each slice lands as an independent, revertible work unit; rollback
boundaries are stated per slice. Archived trace data is never deleted.

## Evidence Gates (explicit, not skippable)

- [ ] Slice 1 requires GitHub admin/authenticated API access — if unavailable at
      apply time, record the immutable blocker in CI-EVIDENCE.md and change
      state; do NOT claim merge enforcement.
- [ ] Slice 2 runtime resolution (PS7 presence vs 5.1 floor relax vs CI
      fallback) is decided by empirical runs at apply time, documented in
      PREFLIGHT-EVIDENCE.md.

## Open Questions

- None blocking. DEC-001 acceptance (and the Slice-1 admin action, if blocked)
  remain human decisions that gate archive, by design.
