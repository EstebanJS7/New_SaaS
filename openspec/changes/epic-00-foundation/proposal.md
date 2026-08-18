# Proposal: EPIC-00 Foundation

## Intent

Create a reproducible, runnable engineering baseline for NewSaaS. Developers
must be able to start the web, API, worker, PostgreSQL, and Redis locally before
any authentication or business domain is introduced.

## Scope

### In Scope

- Establish the pnpm/Turborepo monorepo: `apps/web`, `apps/api`, `apps/worker`,
  and PRD-defined shared packages.
- Add strict TypeScript, lint, format, test, build, environment validation, CI,
  and developer-startup foundations.
- Provide Docker Compose PostgreSQL and Redis; add API liveness, web-to-API
  health verification, worker Redis connectivity, a minimal internal-event
  contract, and guarded demo-seed framework.
- Configure the repository root as the versioned Obsidian vault, with
  `docs/_templates` available to Obsidian; initialize the Git baseline without
  pushing.

### Out of Scope

- Authentication, tenancy/RBAC, database business tables, Core/Veterinary
  features, and real demo-domain data.
- Fiscal integrations, production deployment, external queues/brokers, and
  feature UI beyond health/shell placeholders.
- Changing approved PRD scope or resolving the `docs/` versus `openspec/specs/`
  authority question.

## Capabilities

### New Capabilities

- `foundation-runtime`: Runnable monorepo applications, shared quality
  configuration, health checks, worker bootstrap, and CI baseline.
- `local-development-services`: Documented, isolated local PostgreSQL and Redis
  lifecycle for development.

### Modified Capabilities

None. No existing OpenSpec capability exists.

## Approach

Harden the vault and repository baseline first, then bootstrap the approved
workspace. Keep the modular monolith as three deployables, use Docker Compose
only for local services, and expose no domain behavior. Treat `docs/` as the
human-facing product truth and OpenSpec changes as workflow artifacts until a
separate Decision resolves ownership.

**Proposed first story/slice:** `FOUND-001 Workspace and Vault Bootstrap` — Git
baseline, root vault settings, pnpm/Turborepo layout, shared strict
configuration, and empty app entry points; no service or domain implementation.

## Affected Areas

| Area                                                             | Impact       | Description                               |
| ---------------------------------------------------------------- | ------------ | ----------------------------------------- |
| `.obsidian/`, `.gitignore`, `docs/README.md`                     | New/Modified | Root-vault and template configuration.    |
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `packages/` | New          | Workspace and shared tooling.             |
| `apps/`, `docker-compose.yml`, `.github/workflows/`              | New          | Runnable deployables, local services, CI. |
| `openspec/config.yaml`                                           | Modified     | Record newly available quality commands.  |

## Risks

| Risk                              | Likelihood | Mitigation                                                |
| --------------------------------- | ---------- | --------------------------------------------------------- |
| Docs/OpenSpec ownership diverges  | Med        | Raise a Decision before EPIC-01; do not migrate silently. |
| Local ports or Docker unavailable | Med        | Use configurable env values and clear prerequisites.      |
| Foundation expands into features  | Med        | Enforce explicit non-goals and story acceptance criteria. |

## Rollback Plan

Revert the Foundation commit(s), stop Compose services, and remove only
generated local volumes. No production data, authentication state, or business
records will exist.

## Dependencies

- Node.js, pnpm, Docker Compose, and Git available to contributors.
- User approval for installation/execution actions under `ask-always`.

## Success Criteria

- [ ] Clean checkout completes install, lint, typecheck, test, and build.
- [ ] Documented commands start PostgreSQL, Redis, web, API liveness, and worker
      connectivity.
- [ ] No authentication or business-domain behavior is added.

## Proposal question round

Recorded for review because this proposal was finalized without an interactive
pause:

- Is Git initialization plus a documentation-baseline commit (without push)
  authorized in `FOUND-001`?
- Should versioned `.obsidian` settings be limited to the `docs/_templates`
  location?
- Should `docs/` remain the authoritative product documentation while OpenSpec
  remains workflow-only through EPIC-00?
