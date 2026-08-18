# Foundation Runtime Specification

## Purpose

Runnable NewSaaS baseline: apps, tooling, health, worker, events, CI.

## Requirements

### Requirement: Monorepo workspace

The system SHALL organize code as a pnpm/Turborepo workspace with `apps/web`,
`apps/api`, and `apps/worker`.

#### Scenario: Workspace members present

- GIVEN a clean clone
- WHEN workspace packages are listed
- THEN `apps/web`, `apps/api`, and `apps/worker` appear

### Requirement: Shared strict configuration

The system SHALL provide shared strict TypeScript, lint, and format configs.

#### Scenario: Strict TypeScript enforced

- GIVEN a file with implicit `any`
- WHEN typechecking runs
- THEN it reports an error

### Requirement: Root quality commands

The system SHALL expose root scripts for lint, format-check, typecheck, test,
and build.

#### Scenario: Quality gate from root

- GIVEN dependencies are installed
- WHEN root quality commands run
- THEN each exits zero on a valid baseline

### Requirement: CI baseline

The system SHALL run lint, typecheck, test, and build on every pull request.

#### Scenario: PR quality gate

- GIVEN a pull request targets the default branch
- WHEN CI executes
- THEN failures block merge

### Requirement: Environment validation

The system SHALL validate required environment variables at startup, naming
omissions.

#### Scenario: Missing variable fails fast

- GIVEN the API starts without a required variable
- WHEN bootstrap runs
- THEN it exits non-zero and names the missing variable

### Requirement: API liveness probe

The system SHALL expose a public API liveness endpoint returning HTTP 200 when
running.

#### Scenario: Liveness healthy

- GIVEN the API process is running
- WHEN the liveness endpoint is requested
- THEN it responds 200 with a healthy indicator

### Requirement: Web-to-API health indicator

The system SHALL provide a web health indicator reflecting API liveness.

#### Scenario: API reachable and unreachable

- GIVEN the web is running
- WHEN the API is healthy
- THEN the indicator shows available
- AND when down it shows unavailable

### Requirement: Worker Redis connectivity

The system SHALL start the worker after verifying Redis connectivity.

#### Scenario: Worker with Redis

- GIVEN Redis is reachable
- WHEN the worker starts
- THEN it logs connectivity and runs

### Requirement: Internal event contract

The system SHALL define a type-safe event envelope with name, payload,
timestamp, and dispatcher.

#### Scenario: Event dispatch and handle

- GIVEN a valid event is emitted
- WHEN a handler receives it
- THEN it receives name, payload, and timestamp

### Requirement: Guarded demo-seed framework

The system SHALL provide a demo-seed entry point disabled by default and enabled
only via flag.

#### Scenario: Seed disabled by default

- GIVEN the seed entry point runs without the enablement flag
- WHEN it executes
- THEN it exits without changes and logs disabled
