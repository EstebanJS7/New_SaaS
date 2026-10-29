# Obsidian Vault

Open the repository root as the Obsidian Vault. Documentation lives in `docs/`,
while OpenSpec artifacts and future implementation files remain available
through the same vault.

No community plugin is required.

## Suggested Obsidian settings

Optional core features:

- Backlinks
- Templates
- Properties view
- Graph
- Search

If using Obsidian Templates, set the template folder to:

```text
docs/_templates
```

Do not make the project dependent on a community plugin such as Dataview.
Metadata must remain useful as plain Markdown/YAML and to coding agents.

## Entry points

- [[PRD]]
- [[MVP Scope]]
- [[ROADMAP]]
- [[Architecture Overview]]
- [[Branding and Theming]]
- [[WORKFLOW]]
- [[Release Checklist]]
- [[Tenant Settings]]
- [[Internal Events]]
- [[Reversals and Corrections]]
- [[Data Classification and Retention]]
- [[Demo Tenant and Reproducible Seed]]
- [[UX-UI-ESTADO-Y-CONTINUIDAD]] — guía consolidada de cambios, evidencia y
  próximos pasos.
- [[UX-001-staff-experience-polish]]
- [[UX-002-es-py-and-clinical-workflows]]
- [[UX-003-agenda-patient-lookup]]
- [[UX-004-patient-overview]]
- [[UX-005-appointment-care-sale-navigation]]
- [[UX-006-persistent-care-links]]
- [[UX-007-session-context-recovery]]
- [[UX-008-patient-search-pagination]]
- [[DEC-083-appointment-clinical-sale-journey]]
- [[DEC-080-staff-locale-es-py]]
- [[DEC-081-appointment-patient-identity]]
- [[UX-AUDIT-2026-10-26]]
- [[UX-VALIDATION-2026-10-27]]

## Developer quickstart

Prerequisites: Node.js 22+, pnpm 11+, Docker Compose.

```bash
# Install dependencies
pnpm install

# Copy the example environment file to the repository root and adjust values if needed.
# The API and worker dev scripts load the root .env via Node's built-in --env-file flag.
cp .env.example .env

# Start local PostgreSQL and Redis
pnpm services:up

# Verify services are reachable
pnpm preflight

# Run quality gates
pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build

# Start API and web in development
pnpm dev
```

### Environment loading strategy

Local development uses a single strategy: copy `.env.example` to `.env` in the
repository root. Root `pnpm dev` loads it with Node's built-in `--env-file`,
builds backend dependencies and starts Turbo. API and worker use
`scripts/backend-dev.mjs` to compile with TypeScript (including Nest decorator
metadata) and restart after successful recompilation; their child processes also
load the root file by absolute path. Preflight loads it before invoking its CLI.
`pnpm db:demo` loads reference/base/commercial fixtures with the same
environment; see the README for Windows setup and fixture limitations.
Production `start` scripts do **not** load `.env`; operators must inject
environment variables through the runtime platform. Do not commit `.env` or any
`.env.*.local` file.

See `docs/09-releases/CHANGELOG.md` for the EPIC-00 baseline.
