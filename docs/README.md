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

## Developer quickstart

Prerequisites: Node.js 22+, pnpm 11+, Docker Compose.

```bash
# Install dependencies
pnpm install

# Copy the example environment file and adjust values if needed
# The API, worker, and preflight scripts load .env via Node's built-in --env-file flag.
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
repository root. The `dev` scripts for `apps/api` and `apps/worker` load it with
Node's built-in `--env-file=.env` flag, and the `preflight` scripts do the same
before invoking the preflight CLI. Production `start` scripts do **not** load
`.env`; operators must inject environment variables through the runtime
platform. Do not commit `.env` or any `.env.*.local` file.

See `docs/09-releases/CHANGELOG.md` for the EPIC-00 baseline.
