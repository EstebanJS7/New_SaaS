# Foundation Closeout Governance Specification

## Purpose

Define the documentation authority, closeout gates, and archive eligibility for
EPIC-00.

## Requirements

### Requirement: Documentation authority is declared

`docs/` MUST be the permanent source of truth for product intent, architecture,
ADRs, Decisions, and operational runbooks. OpenSpec active change folders MUST
be temporary SDD trace artifacts that are archived after verification.

#### Scenario: Decision records docs as authority

- GIVEN closeout is in progress
- WHEN the documentation authority Decision is accepted
- THEN `docs/` is declared the permanent source of truth
- AND OpenSpec change folders are declared temporary SDD trace

### Requirement: OpenSpec trace retention is defined

The Decision MUST state how long active OpenSpec traces remain unarchived, or
the condition that triggers archive.

#### Scenario: Decision specifies archive trigger

- GIVEN the documentation authority Decision is accepted
- WHEN the retention rule is read
- THEN it defines the verification condition that permits archive

### Requirement: EPIC records are reconciled before archive

Before archive, EPIC-00 MUST be updated to reflect implemented verification
evidence, any unresolved blockers, and the final closeout status.

#### Scenario: EPIC updated with verification evidence

- GIVEN all closeout criteria are verified
- WHEN EPIC-00 is reviewed
- THEN it references the CI evidence, preflight results, worker signal tests,
  and Decision
- AND its status reflects closeout completion

### Requirement: Archive is gated by verified closeout

The OpenSpec change folder MUST NOT be archived while any closeout criterion is
unverified or any blocker remains unresolved.

#### Scenario: All gates pass and archive proceeds

- GIVEN all closeout criteria are verified
- AND the Decision is accepted
- AND EPIC-00 is reconciled
- WHEN archive is triggered
- THEN the change folder is moved to the archive with an ISO-date prefix

#### Scenario: Unverified blocker prevents archive

- GIVEN a closeout criterion is unverified or a blocker is unresolved
- WHEN archive is triggered
- THEN archive MUST NOT proceed
- AND the remaining item is recorded in the change state
