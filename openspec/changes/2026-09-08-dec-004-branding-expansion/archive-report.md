# Archive Report: DEC-004 Branding Expansion

**Change**: `2026-09-08-dec-004-branding-expansion` **Archived**: not yet moved
(recorded 2026-09-11) **Mode**: openspec (filesystem) **Status**: archive-gated
— evidence complete; the folder stays active until a distinct dated per-folder
move authorization is recorded

This is a **gated archive report** for an active EPIC-03 change. It is additive
and records the archive gate state; it does not rewrite any historical byte and
does not move the folder.

## Archive gate

| Gate                                                     | State       | Evidence                                                                           |
| -------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| Delta specs present                                      | satisfied   | `tenant-branding-assets`, `portal-brand-resolution`, `system-appearance`.          |
| Tasks complete                                           | satisfied   | `tasks.md` Phases 1–7 (superseded open boxes covered by the 2026-09-11 addendum).  |
| Folder verify record present                             | satisfied   | `verify-report.md` (sibling; `pass_with_warnings`, 0 blockers).                    |
| Criterion evidence                                       | satisfied   | Canonical run `34605178149`; Engram #2144 and #2170; committed `b992053..c9cff61`. |
| Dated maintainer epic-closure authorization              | satisfied   | 2026-09-11, `docs/10-qa/CI-EVIDENCE.md` — epic closure only.                       |
| Dated per-folder move authorization                      | **pending** | `CI-EVIDENCE.md` requires a separate dated authorization for each folder move.     |
| Folder moved to `openspec/changes/archive/2026-09-11-…/` | **pending** | Deferred; active folder preserved by the closure change.                           |

The criterion evidence is complete, but per `docs/10-qa/CI-EVIDENCE.md` the
2026-09-11 authorization covers epic implementation closure only. This folder
therefore remains active until a **distinct dated per-folder move
authorization** is recorded; no move is claimed or ready.

## Remaining open items

1. [[TD-007]] Playwright E2E (Branding and Customer) — accepted-deferred.
2. [[TD-009]] virus scanning + reset-cleanup dead-letter alerting/retention —
   open.
3. No production-readiness claim: [[EPIC-20]] Production Hardening remains.

## Specs

The three delta specs remain in the change folder. They are **not** synced into
`openspec/specs/` (D6). The physical archive move, when performed, must carry
them unchanged. Accepted [[DEC-005]] and [[ADR-004]] are documented under
`docs/07-decisions/` and `docs/04-adrs/`.

## Preserved history

`proposal.md`, `design.md`, `tasks.md`, and `apply-progress.md` are unchanged by
this gated report.
