# Archive Report — epic-00-closeout-and-archive

## Metadata

- Archived: 2026-08-23
- Destination: `openspec/archive/2026-08-23-epic-00-closeout-and-archive/`
- Verify verdict: PASS-WITH-AUTHORIZED-DEFERRALS (`verify-report.md`, this
  folder; evidence revision = HEAD `914084f` at verification time; blockers 0,
  critical findings 0, requirements 11/11, scenarios 19/19)
- Closure authorization: repository maintainer, dated 2026-08-23 — archiving
  with Slices 1–2 formally deferred via Tech Debt records (`notes.md`,
  "Authorization record" and "Archive eligibility exception").

## Commits delivered by this change

| Commit  | Subject                                                    |
| ------- | ---------------------------------------------------------- |
| bd74a3a | feat(worker): add signal shutdown extraction and coverage  |
| 2e098ef | docs(tech-debt): record deferred EPIC-00 closeout slices   |
| faa0503 | docs(decisions): propose DEC-001 documentation authority   |
| f383354 | docs(roadmap): reconcile EPIC-00 foundation records        |
| 914084f | chore(openspec): record epic-00-closeout-and-archive trace |

The terminal commit of the cycle is the single archive commit containing this
report, the Unit 5 checkbox reconciliation, and the folder move itself.

## Implemented

- Slice 3 — worker graceful shutdown: exported injectable
  `installSignalShutdown(handle, proc)` in `apps/worker/src/main.ts`; fixed
  swallowed shutdown rejection via `.catch` → log + exit 1; entry point
  delegates. Coverage in `apps/worker/src/main.test.ts`: SIGTERM/SIGINT → clean
  exit 0, second signal inert, rejection logged + non-zero exit. Fresh verify
  run: worker suite 12/12 passed (Turborepo cache bypassed).
- Governance records: TD-001 + TD-002 created; DEC-001 created (status
  `proposed`; acceptance is a documented human gate); EPIC-00 reconciled with
  evidence links and known limitations.
- Full root gates
  (`pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`)
  ran green immediately pre-commit (attestation recorded in verify-report.md
  field notes).

## Deferred (authorized — limitations, never completed work)

- Slice 1 branch-protection verification/configuration: [[TD-001]]
  (`docs/08-tech-debt/TD-001-branch-protection-verification.md`). Blocker: no
  repository-admin/API authority; `gh` absent. Until resolved, CI is green but
  not merge-blocking.
- Slice 2 executable PowerShell preflight evidence: [[TD-002]]
  (`docs/08-tech-debt/TD-002-preflight-execution-evidence.md`). Blocker: PS7 ≥
  7.2 absent locally; script requires ≥ 7.2; CI has no Windows runner job.
- W-1 mid-shutdown repeated-signal OS disposition edge: [[TD-003]]
  (`docs/08-tech-debt/TD-003-worker-repeat-signal-guard.md`). Unit-level
  scenario S3 green; runtime edge accepted as tracked debt.

## EPIC closure

`docs/01-roadmap/EPIC-00-Foundation.md`: status `review` → `done`,
`updated: 2026-08-23`, citing the verify verdict and the maintainer closure
authorization dated 2026-08-23. Known limitations and Tech Debt links
([[TD-001]], [[TD-002]], [[TD-003]]) preserved exactly as recorded. DEC-001
remains `proposed` — acceptance is a human gate and was not touched by the
archive.

## Task reconciliation (Unit 5)

Tasks 5.1–5.3 were checked at archive time under explicit orchestrator
instruction, as exceptional mechanical reconciliation backed by
verify-report.md: gates ran green pre-commit plus a fresh worker execution
during verify; the pre-archive checklist items existed at HEAD `914084f`; task
5.3 completes with the commit that performs this archive move. No new
implementation work was performed by the archive phase.

## Specs note

Delta specs (`foundation-runtime`, `local-development-services`,
`foundation-closeout-governance`) are preserved verbatim in this archived folder
as the audit trail. They were not merged into `openspec/specs/` because that
directory holds no main specs in this repository: DEC-001 (pending acceptance)
designates `docs/` as the permanent documentation authority and OpenSpec change
folders as temporary SDD trace.

## Audit trail

The change folder was moved mechanically with `git mv` into the archive; a
recursive `diff -r` against a pre-move snapshot returned no differences. Nothing
was deleted or modified inside the archived artifacts except the Unit 5 checkbox
reconciliation and this additive report, both documented above.
