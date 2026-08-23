# Proposal: EPIC-00 Closeout and Archive

## Intent

Resolve the remaining EPIC-00 verification limitations before archive. The
foundation must have enforceable CI, executable Windows preflight evidence,
proven graceful worker shutdown, and one documented documentation authority.

## Scope

### In Scope

- Verify `main` branch protection through an authorized GitHub path; configure
  required `Lint, Typecheck, Test, Build` only with repository-admin authority
  and record the immutable outcome.
- Run `infra/scripts/preflight.ps1` through available `powershell.exe` (or add
  CI evidence if that runtime becomes unavailable), covering success and named
  failure paths.
- Add automated entry-point SIGTERM/SIGINT graceful-shutdown coverage for
  `apps/worker`, including Redis/Nest cleanup and exit status `0`.
- Create a proposed Decision declaring `docs/` the permanent documentation
  source of truth and OpenSpec change folders temporary SDD trace; reconcile
  EPIC-00 records and archive only after all verification passes.

### Out of Scope

- Product/domain functionality, new infrastructure, or changing the approved
  PRD.
- GitHub policy mutation without confirmed administrator authorization.
- Archiving while any closeout criterion is unverified or blocked.

## Capabilities

### New Capabilities

- `foundation-closeout-governance`: Documentation authority, verified closeout
  gates, and archive eligibility for the foundation baseline.

### Modified Capabilities

- `foundation-runtime`: CI merge enforcement and worker signal-shutdown
  behavior.
- `local-development-services`: Executable PowerShell preflight parity evidence.

## Approach

Use small, independently verifiable slices. Start with read-only GitHub policy
inspection; the remote is reachable, but `gh` is unavailable, so admin/API
access is an explicit prerequisite. Validate directly with WSL's available
`powershell.exe`; retain a Windows CI fallback only if direct execution fails.
Then add process-level worker signal tests, record the Decision, rerun the
quality/targeted checks, reconcile EPIC documentation, and archive last.

## Proposal Question Round

Assumption for maintainer review: an authorized repository administrator may
perform branch-policy configuration outside application code. Should the
Decision also define how long active OpenSpec traces remain before archive?

## Affected Areas

| Area                                                      | Impact   | Description                         |
| --------------------------------------------------------- | -------- | ----------------------------------- |
| `.github/workflows/ci.yml`, `docs/10-qa/CI-EVIDENCE.md`   | Modified | Evidence/policy reconciliation.     |
| `infra/scripts/preflight.ps1`, tests/CI                   | Modified | Windows runtime validation.         |
| `apps/worker/src/main.ts`, `apps/worker/src/main.test.ts` | Modified | Signal shutdown coverage.           |
| `docs/07-decisions/`, `docs/01-roadmap/`, `openspec/`     | Modified | Authority, closeout, archive trace. |

## Risks

| Risk                             | Likelihood | Mitigation                                                |
| -------------------------------- | ---------- | --------------------------------------------------------- |
| No GitHub admin/API access       | Med        | Record blocker; do not claim merge enforcement.           |
| Windows runtime differs from WSL | Low        | Run `powershell.exe`; use documented Windows CI fallback. |

## Rollback Plan

Revert worker/tests/docs/CI evidence commits. Restore the prior GitHub policy
only through the authorized administrator; do not delete archived trace data.

## Dependencies

- Repository-admin or authenticated GitHub API/CLI access for branch protection.
- Windows PowerShell available through `/mnt/c/Windows/.../powershell.exe`.

## Success Criteria

- [ ] Branch-policy result is verified and evidenced; any permission blocker is
      explicit.
- [ ] PowerShell preflight and worker signal-shutdown tests pass.
- [ ] Decision, EPIC reconciliation, full verification, and archive are complete
      in order.
