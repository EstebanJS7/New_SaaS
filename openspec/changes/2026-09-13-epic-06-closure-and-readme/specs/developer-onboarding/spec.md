# developer-onboarding Specification

## Purpose

Neutral professional Spanish root `README.md` that lets a developer set up and
run the project safely and links to authoritative docs instead of duplicating
product truth.

## Requirements

### Requirement: Spanish onboarding README

The root `README.md` SHALL be written in neutral professional Spanish and SHALL
present a short, outcome-oriented onboarding path followed by links to
authoritative documentation. It MUST NOT restate or modify approved product
scope.

#### Scenario: Spanish onboarding path

- GIVEN a new developer opens `README.md`
- WHEN they follow the documented path
- THEN they reach a running local stack using Spanish instructions

#### Scenario: No duplicated product truth

- GIVEN approved scope lives in the PRD and docs
- WHEN README content is written
- THEN it links to those sources rather than restating or editing scope

### Requirement: Safe local setup

The README SHALL document safe local setup using placeholder-safe values only:
environment setup, service start/stop, migrations, seed, and the quality
commands. It MUST NOT expose secrets or real credentials.

#### Scenario: Setup from example env

- GIVEN no local `.env`
- WHEN the developer copies `.env.example` and follows the README
- THEN services start, migrations and seed run, and quality gates execute

#### Scenario: No secrets in README

- GIVEN the README is committed to the repository
- WHEN it is inspected
- THEN it contains no secrets, tokens, or real credentials

### Requirement: Source-of-truth links

The README SHALL link to the governance, PRD, roadmap, module, and CI-evidence
sources so readers can verify claims, and MUST NOT decide the
`FILE-MANIFEST.md` disposition.

#### Scenario: Links resolve

- GIVEN the README references authoritative docs
- WHEN a reader opens a link
- THEN it points to an existing repository path

#### Scenario: Manifest left undecided

- GIVEN the `FILE-MANIFEST.md` disposition is out of scope
- WHEN the README is written
- THEN it neither decides nor claims that disposition
