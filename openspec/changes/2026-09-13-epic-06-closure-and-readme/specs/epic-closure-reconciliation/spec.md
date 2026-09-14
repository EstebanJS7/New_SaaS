# epic-closure-reconciliation Specification

## Purpose

Documentation-only closure of EPIC-06: reconcile epic, story, roadmap, module,
release, debt, and OpenSpec status records to the canonical evidence while
keeping limitations and open debt explicit.

## Requirements

### Requirement: Truthful status reconciliation

EPIC-06 and VET-004 SHALL be set to `done` only when every acceptance criterion
maps to the archived EPIC-06 verification evidence; the roadmap and
`openspec/config.yaml` SHALL reflect the reconciled status. No record SHALL
claim production readiness.

#### Scenario: Reconciled to done

- GIVEN the archived EPIC-06 verification report passes all acceptance criteria
- WHEN EPIC-06 and VET-004 status records are updated
- THEN both read `done` with `updated` set, and roadmap/config match

#### Scenario: Missing evidence blocks done

- GIVEN an acceptance criterion has no verifiable evidence
- WHEN closure reconciliation runs
- THEN status stays non-done and the gap is recorded

### Requirement: Evidence alignment

Every closure assertion SHALL cite the archived EPIC-06 verification report and
the canonical push-to-main CI run `34793644348` at `ff786138`. Records MUST NOT
cite unobserved, local-only, or stale evidence.

#### Scenario: Canonical run cited

- GIVEN the canonical EPIC-06 CI run is recorded in `docs/10-qa/CI-EVIDENCE.md`
- WHEN closure evidence is written
- THEN each status transition cites that run and the archived report

#### Scenario: Unobserved evidence rejected

- GIVEN a claim whose CI observation has not occurred
- WHEN evidence is recorded
- THEN the claim is marked pending/local-only and not counted as closure proof

### Requirement: Debt and limitation visibility

Closure SHALL preserve every open debt item and known limitation. Only a debt
item proven satisfied by CI observation MAY be checked; unrelated debt MUST
remain open and separate, and no code fix is in scope.

#### Scenario: Proven item checked

- GIVEN TD-006's EPIC-06 clinical CI-observation item is green in the canonical run
- WHEN debt records are reconciled
- THEN only that item is checked and its remaining gates stay open

#### Scenario: Unrelated debt untouched

- GIVEN TD-011 and other non-CI debt items are open
- WHEN closure reconciliation runs
- THEN they remain open with no status or code change
