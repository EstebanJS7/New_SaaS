# Design: EPIC-00 Foundation

Runnable monorepo baseline: `apps/web`, `apps/api`, `apps/worker` + Dockerised
local PG/Redis, strict quality gates, typed event envelope, and a
product-neutral branding boundary that names `Clinical Precision` as the future
Veterinary preset without expanding scope.

## Architecture decisions

| #   | Decision          | Choice                                                                                           | Rationale                                               |
| --- | ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| D1  | Workspace         | pnpm + Turborepo                                                                                 | PRD §3/§4; lowest cognitive load for three apps.        |
| D2  | Shared config     | `packages/{typescript-config,eslint-config,prettier-config,vitest-config}` consumed by every app | One fact per rule; spec "shared strict configuration".  |
| D3  | API framework     | NestJS on Fastify adapter, no domain modules                                                     | PRD §3; module boundaries scaffolded for EPIC-01.       |
| D4  | Worker shape      | NestJS standalone + BullMQ bootstrap, no queues                                                  | Same conventions as API; BullMQ needed for Redis probe. |
| D5  | Env validation    | Zod schema per app, fail-fast, names missing var                                                 | Spec requires named non-zero exit.                      |
| D6  | Health surface    | `/health/live` only; `/health/ready` deferred                                                    | PRD §30; readiness needs DB+Redis after EPIC-01.        |
| D7  | Internal events   | In-process dispatcher + typed envelope in `packages/shared`; no subscribers                      | ADR-003: events don't replace transactions.             |
| D8  | Demo seed         | CLI binary disabled unless `ENABLE_DEMO_SEED=true`                                               | Spec "disabled by default".                             |
| D9  | Local services    | Docker Compose only, named PG volume, configurable ports + creds                                 | Spec "isolated, configurable … persists after restart". |
| D10 | Branding boundary | Document three-layer model; ship type+schema stub + neutral `CoreDesignDefaults` only            | User constraint: tenant resolution deferred to EPIC-03. |

## Branding boundary (future-compatible, no scope expansion)

```text
CoreDesignDefaults        ← foundation ships this (neutral)
ProductBrandPreset        ← EPIC-03 ships this (per vertical)
TenantBranding overrides  ← EPIC-03 ships this (validated, asset-only)
```

EPIC-00 ships
`packages/ui/src/branding/{core-defaults.ts,brand-theme.schema.ts,types.ts}` —
Zod schema, `BrandTheme` type, neutral semantic tokens; **not consumed yet**.
`docs/05-modules/branding.md` names `Clinical Precision` (teal/slate, Inter,
defined radii/elevation/spacing, data-mono numeric, desktop-first) as the future
`veterinary-default` preset — no preset file is created. shadcn/ui uses only
`bg-primary`, `text-foreground`, `border-border`, `bg-card`, `ring-ring`. No
literal Veterinary colour (`bg-teal-600`, `#12AB34`). Tenant white-label
(name/logo, validated assets) stays strictly deferred.

## Startup health gate

```text
APP bootstrap
  ├─ Zod env.parse(ENV)        → throw → exit 1 (names missing key)
  ├─ API:  NestFactory.create  → /health/live returns 200
  ├─ Worker: Redis ping        → throw → exit 1
  └─ shared-event-dispatcher   → boot, zero subscribers
```

Web `<HealthIndicator/>` polls `NEXT_PUBLIC_API_URL/health/live` via TanStack
Query; renders available/unavailable. No business calls.

## File changes

| Path                                                                                        | Action                                                                                  |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`                                         | Create — root workspace + task graph.                                                   |
| `packages/{typescript-config,eslint-config,prettier-config,vitest-config,config,shared,ui}` | Create — strict shared config; event envelope/dispatcher; branding stub.                |
| `apps/web` (Next.js + TS + Tailwind + shadcn/ui init)                                       | Create — `<BrandProvider/>`, `<HealthIndicator/>`, neutral token CSS.                   |
| `apps/api` (NestJS + Fastify + Prisma client bootstrap)                                     | Create — `/health/live`, Zod-env, structured logger.                                    |
| `apps/worker` (NestJS standalone + BullMQ)                                                  | Create — Redis ping at boot, no queues.                                                 |
| `docker-compose.yml`, `.env.example`, `infra/scripts/preflight.{ps1,sh}`                    | Create — PG 16 + Redis 7 + reachability pre-flight.                                     |
| `.opencode/commands/demo-seed.ts`                                                           | Create — guarded CLI; off unless flag set.                                              |
| `.github/workflows/ci.yml`, `.obsidian/app.json`, `.gitignore`                              | Create — CI; vault templates = `docs/_templates`; git init + baseline commit (no push). |
| `docs/05-modules/branding.md`, `docs/09-releases/CHANGELOG.md`                              | Modify/Add — preset intent + Unreleased entry.                                          |
| `openspec/config.yaml`                                                                      | Modify — flip `testing.*` to `available: true`.                                         |

## Contracts

```ts
// packages/shared/src/events/envelope.ts
export interface ApplicationEvent<TType extends string, TPayload> {
  id: string;
  type: TType;
  occurredAt: string;
  tenantId: string | null;
  aggregateId: string;
  payload: TPayload;
}
```

`BrandTheme` lives only as a forward-declared type; no runtime resolution is
wired.

## Testing strategy

Vitest for unit (Zod-env, event dispatcher, brand schema, pre-flight) and
integration (`/health/live` 200, indicator up/down, demo-seed disabled path via
Supertest). E2E (Playwright) deferred until app surfaces exist.

## Threat matrix

N/A — EPIC-00 introduces no user-content routing, no shell/subprocess execution,
no VCS/PR automation, no executable-file classification, no external process
integration. Brand schema rejects arbitrary CSS/JS by construction; no tenant
upload path exists yet.

## Rollout

No data migration. Chained PRs (per `chained-pr`, ≤ 400 changed lines/slice):

1. `FOUND-001` vault + git + workspace skeleton (no app code).
2. `FOUND-002` shared configs + root scripts + CI.
3. `FOUND-003` docker-compose + pre-flight.
4. `FOUND-004` API scaffold + liveness + env validation.
5. `FOUND-005` web scaffold + shadcn init + neutral tokens + health indicator.
6. `FOUND-006` worker scaffold + Redis ping + event envelope + guarded demo-seed
   CLI.

## Open questions

- [ ] Authorise `git init` + a documentation-baseline commit (no push) inside
      `FOUND-001`?
- [ ] Keep `.obsidian/` settings limited to `templatesFolder = docs/_templates`?
- [ ] Confirm tenant white-label storage/API stays out of EPIC-00 (deferred to
      EPIC-03)?

Next: **sdd-tasks** to break EPIC-00 into the six `FOUND-*` slices above.
