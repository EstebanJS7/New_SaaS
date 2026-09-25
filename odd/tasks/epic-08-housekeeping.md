# EPIC-08 housekeeping before EPIC-09

## Objective and rationale

Reconcile local generated/stale EPIC-08 artifacts and contradictory
decision/roadmap context before starting EPIC-09. Preserve the unique WU4
delivery trace; do not change product behavior or start EPIC-09 implementation.
User chose preserving the trace, cleaning local leftovers, and full documentary
coherence. No commit/push authorized.

## Scope and constraints

- Preserve unique historical facts from `odd/tasks/epic-08-portal-wu4.md` in the
  tracked EPIC-08 archive before retiring the stale local task.
- Remove the obsolete untracked live `openspec/changes/epic-08/` copy only after
  verifying the tracked archive is newer and complete.
- Stop tracking generated `.atl` files without deleting local working copies;
  keep `.atl/` ignored. Treat `.codegraph/` as regenerable local cache; ignore
  rather than delete its index.
- Reconcile the accepted DEC-008 statements in the decision and EPIC-08 record,
  and current roadmap line in `openspec/config.yaml`.
- Do not disturb other user content, rewrite history, commit, push or start
  EPIC-09 here.
- TDD: disabled (`openspec/config.yaml` strict_tdd: false). Runner `pnpm test`;
  documentation/local housekeeping needs structural and format checks, not
  invented RED/GREEN proof.

## Tasks

- [x] H1: Preserve the unique WU4 delivery trace in the EPIC-08 archived record;
      verify the source trace remains until the archived copy is checked.
- [x] H2: Reconcile DEC-008 acceptance in
      `docs/07-decisions/DEC-008-first-party-portal-identity.md` and
      `docs/01-roadmap/EPIC-08-Portal.md`, and update `openspec/config.yaml`
      roadmap context; inspect resulting diff.
- [x] H3: Retire obsolete local EPIC-08 change and old ODD task after
      preservation; stop tracking generated `.atl` files without deleting local
      copies, ignore local `.codegraph/`; verify tracked archive and local Git
      status, run applicable documentation/structural checks.

## Acceptance and verification

- Historical WU4 details have a clear, non-authoritative archival home; no
  duplicate active OpenSpec change or stale local ODD task remains.
- DEC-008 frontmatter/body and EPIC-08 reference consistently say accepted;
  config matches roadmap (00–08 done, 09 planned).
- `.atl` local files remain on disk but are no longer tracked; `.codegraph`
  index is preserved locally and ignored; unrelated work remains untouched.
- Report exact checks and any remaining dirty state. A clean working tree is not
  assumed without a commit.

## Progress

- Exploration: compared archived and local change; archive is newer and includes
  additional scheduling spec and archive report. The ODD trace has unique
  slice-level delivery details. `.atl` files are tracked despite an ignore rule;
  `.codegraph` is an untracked generated cache. User approved the
  preserve-and-clean strategy and full documentary reconciliation.
- H1: `openspec/changes/archive/2026-09-21-epic-08/wu4-delivery-trace.md`
  preserves the unique slice and review lessons, explicitly marks superseded
  claims, and still has the local source present. Focused
  `pnpm exec prettier --check` and `git diff --check` passed after correction.
- H2: Decision prose and EPIC-08 now reflect DEC-008 acceptance on 2026-09-22;
  EPIC-08 `updated` is reconciliation date 2026-09-25. OpenSpec context points
  to EPIC-09 next. `git diff --check` and targeted Prettier passed before the
  metadata date adjustment (format unchanged by date).
- H3: Removed stale untracked `openspec/changes/epic-08/` and original ODD WU4
  source after preserving its trace. `git rm --cached` removed two generated
  `.atl` files from the index while leaving them on disk; `.gitignore` covers
  `.atl/` and `.codegraph/`, whose DB remains on disk. Added a
  historical-snapshot note to the archive report; reconciled EPIC-08's obsolete
  limitations and TD-012 prose without rewriting historical evidence.
- Verification: independent structural checks passed. `pnpm format-check`
  initially failed on this task document, then on EPIC-08, then on the archive
  report during corrections; all were formatted. Final `pnpm format-check`,
  `git diff --check` and `git diff --cached --check` passed. Application lint,
  typecheck, tests, build and live-PG were skipped because runtime code was
  unchanged. Git remains intentionally dirty pending an authorized commit:
  `.atl` removals are staged index-only, docs/ignore and new trace/task
  unstaged.
- Next: Begin read-only EPIC-09 exploration; request explicit authorization
  before any commit.
