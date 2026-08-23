# Local Development Services Specification

## Purpose

Define executable validation of local PostgreSQL and Redis services through the
Windows preflight script.

## Requirements

### Requirement: PowerShell preflight runs the preflight CLI

The preflight script MUST execute under an available PowerShell runtime and
invoke the preflight CLI, returning the CLI's exit code.

#### Scenario: All services reachable

- GIVEN PostgreSQL and Redis are running at the configured host and ports
- WHEN the PowerShell preflight script runs
- THEN the CLI reports both services reachable
- AND the script exits with status `0`

### Requirement: PowerShell preflight reports named failures

The preflight script MUST report a clear, named error and exit with a non-zero
status for each failure path.

#### Scenario: Preflight CLI is not built

- GIVEN the preflight CLI distribution is absent
- WHEN the script runs
- THEN it outputs an error stating the CLI is not built
- AND it exits with a non-zero status

#### Scenario: Invalid port argument

- GIVEN a port argument that is not an integer between 1 and 65535
- WHEN the script runs
- THEN it outputs an error naming the invalid port
- AND it exits with a non-zero status

#### Scenario: PostgreSQL is unreachable

- GIVEN Redis is reachable but PostgreSQL is not
- WHEN the script runs
- THEN the CLI reports PostgreSQL unreachable
- AND the script exits with a non-zero status

#### Scenario: Redis is unreachable

- GIVEN PostgreSQL is reachable but Redis is not
- WHEN the script runs
- THEN the CLI reports Redis unreachable
- AND the script exits with a non-zero status

### Requirement: Windows runtime fallback is evidenced

If the local PowerShell runtime is unavailable, equivalent Windows preflight
evidence MUST be provided by CI.

#### Scenario: CI supplies Windows preflight evidence

- GIVEN `powershell.exe` cannot be invoked locally
- WHEN the CI workflow runs on a Windows runner
- THEN it executes the preflight script
- AND records the success or failure outcome as an artifact
