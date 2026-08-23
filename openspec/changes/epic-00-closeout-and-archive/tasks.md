# Tasks: EPIC-00 Closeout and Archive

Maintainer scope decision (2026-08-23, authoritative): implement Slice 3 + Slice
4 only. Slices 1–2 deferred as explicit task groups whose completion action is
Tech Debt records. Archive LAST.

## Review Workload Forecast

| Field                   | Value                          |
| ----------------------- | ------------------------------ |
| Estimated changed lines | ~300–390 total                 |
| 400-line budget risk    | Medium                         |
| Chained PRs recommended | No                             |
| Suggested split         | Single PR, 5 work-unit commits |
| Delivery strategy       | ask-always                     |
| Chain strategy          | pending                        |

### Suggested Work Units

| Unit | Goal                                                   | Likely PR | Focused test command                                                          | Runtime harness                                                  | Rollback boundary                                    |
| ---- | ------------------------------------------------------ | --------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | Worker signal-shutdown extraction + coverage (Slice 3) | PR 1      | `pnpm test --filter @newsaas/worker`                                          | Vitest EventEmitter stub + spied `exit`; no child-process spawns | Revert commit; `main.ts` returns to current behavior |
| 2    | Deferred Slices 1–2 → Tech Debt records                | PR 1      | `pnpm format-check` (docs-only)                                               | N/A — governance records, no runtime path                        | Revert docs commit only                              |
| 3    | DEC-001 (`proposed`)                                   | PR 1      | `pnpm format-check` (docs-only)                                               | N/A — decision record                                            | Revert docs commit only                              |
| 4    | EPIC-00 reconciliation                                 | PR 1      | `pnpm format-check` (docs-only)                                               | N/A — roadmap record                                             | Revert docs commit only                              |
| 5    | Final gates + archive (terminal)                       | PR 1      | `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build` | Full root gates per `openspec/config.yaml`                       | Un-archive = move folder back                        |

## Unit 1 — Worker SIGTERM/SIGINT graceful shutdown (Slice 3)

- [x] 1.1 RED: add failing tests to `apps/worker/src/main.test.ts` for all
      foundation-runtime scenarios: SIGTERM → `handle.shutdown()` invoked, exit
      `0`; SIGINT → exit `0`; second signal after first is inert (both listeners
      removed, shutdown runs once, exit stays `0`); rejection → `console.error`
      logged + non-zero exit. Injectable emitter stub +
      `vi.spyOn(process, "exit")`. Verify: `pnpm test --filter @newsaas/worker`
      (RED). Depends: none.
- [x] 1.2 GREEN: in `apps/worker/src/main.ts` extract exported
      `installSignalShutdown(handle: WorkerHandle, proc: Pick<NodeJS.Process, "once" | "off" | "exit"> = process): void`;
      entry point delegates; fix swallowed rejection by adding `.catch` on the
      shutdown promise → log + `process.exit(1)`. Verify:
      `pnpm test --filter @newsaas/worker && pnpm typecheck --filter @newsaas/worker && pnpm lint --filter @newsaas/worker`
      (GREEN). Depends: 1.1.

Commit:
`feat(worker): extract installSignalShutdown with tested graceful shutdown`

## Unit 2 — DEFERRED Slices 1–2 → Tech Debt records

Slices 1–2 are NOT implemented here (maintainer decision). Completion action:
records in `docs/08-tech-debt/` from `docs/_templates/TECH-DEBT.md`, status
`open`, valid frontmatter, links to this change folder.

- [x] 2.1 TD-001 branch-protection verification/configuration: blocker = no
      repo-admin/API authority (`gh` absent); evidence gate = protection API
      response quoted in `docs/10-qa/CI-EVIDENCE.md` or explicit blocker
      paragraph; re-entry = authorized admin access. Verify:
      `pnpm format-check`. Depends: none.
- [x] 2.2 TD-002 preflight execution evidence: blocker = PS7 absent locally
      (only Windows PowerShell 5.1; script has `#Requires -Version 7.2`);
      evidence gate = 5-scenario matrix in `docs/10-qa/PREFLIGHT-EVIDENCE.md` or
      documented Windows CI fallback; re-entry = PS7 >= 7.2 locally or CI
      Windows runner job. Verify: `pnpm format-check`. Depends: none.

Commit: `docs(tech-debt): record deferred EPIC-00 closeout evidence blockers`

## Unit 3 — DEC-001 documentation authority

- [x] 3.1 Create
      `docs/07-decisions/DEC-001-documentation-authority-and-openspec-trace.md`
      from `docs/_templates/DECISION.md`, status `proposed`: `docs/` is
      permanent source of truth; `openspec/changes/*` are temporary SDD trace;
      archive trigger = closeout gates verified AND blockers resolved or
      formally deferred via Tech Debt. Verify: `pnpm format-check`. Depends:
      2.1, 2.2.

Commit:
`docs(decisions): propose DEC-001 documentation authority and OpenSpec trace policy`

## Unit 4 — EPIC-00 reconciliation

- [x] 4.1 Update `docs/01-roadmap/EPIC-00-Foundation.md`: tick only evidenced
      criteria (worker signal tests, full gates), link DEC-001 + TD-001 +
      TD-002, fill Implementation Notes including deferred-slice limitations,
      bump `updated`. Do NOT alter acceptance criteria text. Verify:
      `pnpm format-check`. Depends: 1.2, 2.2, 3.1.

Commit: `docs(EPIC-00): reconcile acceptance criteria with closeout evidence`

## Unit 5 — Final verification and archive (LAST)

- [ ] 5.1 Run full root gates:
      `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`.
      Any red ⇒ NO archive; record remainder in change state. Depends: 4.1.
- [ ] 5.2 Pre-archive checklist: Unit 1 green; TD-001 + TD-002 exist; DEC-001
      created; EPIC reconciled. Document the maintainer-authorized archive
      eligibility exception (deferred Slices 1–2, authorization dated
      2026-08-23) explicitly in the change state — never hidden. Depends: 5.1.
- [ ] 5.3 Archive: move `openspec/changes/epic-00-closeout-and-archive/` →
      `openspec/archive/<YYYY-MM-DD>-epic-00-closeout-and-archive/`; audit trail
      preserved, nothing deleted. Depends: 5.2.

This unit's commit also includes this change's own OpenSpec trace folder
(proposal, specs, design, tasks, notes), which has no other commit assignment.

Commit: `chore(EPIC-00): archive epic-00-closeout-and-archive trace`
