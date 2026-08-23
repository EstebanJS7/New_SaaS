# Foundation Runtime Specification

## Purpose

Define the runtime behavior of the worker process and the CI merge-protection
gate that underpins EPIC-00 closeout.

## Requirements

### Requirement: Worker graceful shutdown on SIGTERM and SIGINT

The worker entry point MUST register handlers for `SIGTERM` and `SIGINT` that
trigger the bootstrap shutdown sequence. When shutdown completes successfully,
the process MUST exit with status `0`.

#### Scenario: SIGTERM initiates clean shutdown

- GIVEN the worker has bootstrapped successfully
- WHEN the process receives `SIGTERM`
- THEN the shutdown sequence is invoked
- AND the process exits with status `0`

#### Scenario: SIGINT is also handled cleanly

- GIVEN the worker has bootstrapped successfully
- WHEN the process receives `SIGINT`
- THEN the shutdown sequence is invoked
- AND the process exits with status `0`

#### Scenario: Repeated signals do not re-run shutdown

- GIVEN the worker is already shutting down after a signal
- WHEN a second `SIGTERM` or `SIGINT` arrives
- THEN the shutdown sequence MUST NOT be invoked a second time
- AND the final exit status remains `0`

### Requirement: Worker shutdown failures report non-zero exit

If the shutdown sequence fails, the worker MUST exit with a non-zero status and
log the failure.

#### Scenario: Shutdown error yields failure exit code

- GIVEN the worker has bootstrapped successfully
- WHEN the process receives `SIGTERM`
- AND the shutdown sequence rejects with an error
- THEN the process exits with a non-zero status

### Requirement: Branch protection is verified through an authorized path

The closeout process MUST verify the default branch protection rule and record
the immutable outcome. Verification MUST be performed through repository-admin
authority, the GitHub CLI, or an authenticated GitHub API call.

#### Scenario: Admin verifies required status check is configured

- GIVEN a repository administrator has authenticated access
- WHEN the protection rule for the default branch is inspected
- THEN the required status check `Lint, Typecheck, Test, Build` is listed
- AND the outcome is recorded as evidence

#### Scenario: Missing access is recorded as a blocker

- GIVEN the GitHub CLI or API is unavailable or the actor lacks admin rights
- WHEN branch protection is inspected
- THEN the inability to verify or configure protection is recorded explicitly
- AND no merge-blocking claim is made

### Requirement: Branch protection configuration requires admin authority

The required status check `Lint, Typecheck, Test, Build` MUST only be configured
by a repository administrator. Non-admin agents or application code MUST NOT
modify branch protection.

#### Scenario: Admin configures required check

- GIVEN the check is not yet required
- WHEN a repository administrator enables the rule
- THEN `Lint, Typecheck, Test, Build` is listed as a required status check
- AND the configuration action is recorded as immutable evidence

#### Scenario: Unauthorized mutation attempt is rejected

- GIVEN an actor lacks repository-admin authority
- WHEN an attempt is made to modify the branch protection rule
- THEN the attempt MUST fail or be refused
- AND the unauthorized outcome is recorded
