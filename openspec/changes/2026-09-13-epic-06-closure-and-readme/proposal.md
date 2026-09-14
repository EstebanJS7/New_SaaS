# Proposal: EPIC-06 Closure Reconciliation and Root README

## Intent

Close the documentary record for the merged, CI-green EPIC-06 and provide a
current, safe developer onboarding entry point without overstating production
readiness.

## Scope

### In Scope

- Reconcile EPIC-06, VET-004, roadmap, release, module, OpenSpec, and
  CI-evidence records to the canonical main CI run `34793644348` at `ff786138…`.
- Mark EPIC-06 and VET-004 done while retaining design §10 limitations and all
  nonblocking open debt.
- Check only TD-006's satisfied CI-observation item; preserve its remaining
  gates as open.
- Rewrite `README.md` in neutral professional Spanish for developer onboarding:
  product summary, links, safe setup, services, migrations, seed, and quality
  commands.

### Out of Scope

- TD-011 runtime hardening or any application, migration, or test change.
- Resolving design §10 product questions, closing unrelated debt, or claiming
  production readiness.
- Duplicating PRD/product truth, exposing secrets, or deciding the
  `FILE-MANIFEST.md` disposition.

## Capabilities

### New Capabilities

None — this is documentation and evidence reconciliation only.

### Modified Capabilities

None — no OpenSpec requirement changes are proposed.

## Approach

Map each closure assertion to the archived EPIC-06 verification report and
canonical push-to-main CI evidence before updating status records. Keep
limitations and debt explicit. Structure the README around a short onboarding
path, then link to authoritative documentation rather than copying it.

## Affected Areas

| Area                                                                         | Impact   | Description                                      |
| ---------------------------------------------------------------------------- | -------- | ------------------------------------------------ |
| `README.md`                                                                  | Modified | Spanish developer onboarding                     |
| `docs/01-roadmap/`, `docs/02-stories/`                                       | Modified | EPIC/VET-004 closure evidence                    |
| `docs/05-modules/`, `docs/08-tech-debt/`, `docs/09-releases/`, `docs/10-qa/` | Modified | Reconciled status, debt, release, and CI records |
| `openspec/config.yaml`                                                       | Modified | Current roadmap and CI baseline                  |

## Risks

| Risk                                         | Likelihood | Mitigation                                                      |
| -------------------------------------------- | ---------- | --------------------------------------------------------------- |
| Done is read as production-ready             | Medium     | State implementation-only closure; retain EPIC-20 and open debt |
| Evidence becomes stale or overstated         | Low        | Cite only run `34793644348` and archived verification           |
| README duplicates or leaks sensitive details | Low        | Link to source docs; use placeholder-safe commands only         |

## Rollback Plan

Revert this documentation-only change as one commit, restoring prior statuses
and README; no runtime data or schema rollback is required.

## Dependencies

- Archived EPIC-06 verification report and canonical CI run `34793644348`.

## Success Criteria

- [ ] EPIC-06 and VET-004 are done with traceable evidence and explicit
      limitations/debt.
- [ ] TD-006 remains open except for its proven CI-observation item; TD-011
      remains separate.
- [ ] The Spanish README enables safe local setup without duplicating product
      truth or secrets.
