# Local Development Services Specification

## Purpose

Local PostgreSQL and Redis lifecycle for development.

## Requirements

### Requirement: Local PostgreSQL service

The system SHALL provide an isolated, configurable local PostgreSQL service for
development.

#### Scenario: PostgreSQL starts and persists

- GIVEN Docker Compose is available
- WHEN the documented start command runs
- THEN PostgreSQL is reachable on configured port
- AND data persists after restart

### Requirement: Local Redis service

The system SHALL provide an isolated, configurable local Redis service for
development.

#### Scenario: Redis starts

- GIVEN Docker Compose is available
- WHEN the documented start command runs
- THEN Redis is reachable on configured port

### Requirement: Service lifecycle documentation

The system SHALL document start, stop, and reset commands plus prerequisites.

#### Scenario: Contributor starts services

- GIVEN prerequisites are installed
- WHEN the startup documentation is followed
- THEN PostgreSQL and Redis are reachable

### Requirement: Pre-flight service check

The system SHALL provide a command that verifies PostgreSQL and Redis
reachability.

#### Scenario: Pre-flight passes and fails

- GIVEN both services are running
- WHEN the pre-flight command runs
- THEN it reports both reachable
- AND when unavailable, names it and exits non-zero
