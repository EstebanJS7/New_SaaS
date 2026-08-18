---
id: EPIC-00
type: epic
title: Foundation
status: ready
priority: critical
depends_on: []
prd_sections:
  - "2"
  - "3"
  - "4"
created: 2026-08-13
updated: 2026-08-13
---

# EPIC-00 — Foundation

## Objective

Create the reproducible monorepo and engineering foundation without implementing
business features.

## Scope

- pnpm workspace;
- Turborepo;
- `apps/web`;
- `apps/api`;
- `apps/worker`;
- shared packages defined by PRD;
- TypeScript strict configuration;
- ESLint;
- formatting;
- environment validation foundation;
- local PostgreSQL + Redis development services;
- CI skeleton;
- base scripts;
- minimal internal event-dispatcher contract (no business events yet);
- deterministic demo seed framework/guard (domain data added by later epics);
- README developer startup.

## Out of scope

- business tables;
- Customer/Patient features;
- SIFEN integration;
- production deployment;
- feature UI beyond base app health/shell placeholders.

## Acceptance Criteria

- [ ] `pnpm install` succeeds from a clean checkout.
- [ ] Workspace layout matches PRD.
- [ ] TypeScript strict configuration is shared.
- [ ] `pnpm lint` succeeds.
- [ ] `pnpm typecheck` succeeds.
- [ ] `pnpm test` has a valid baseline and succeeds.
- [ ] `pnpm build` succeeds.
- [ ] Local PostgreSQL and Redis can start from documented commands.
- [ ] API provides a basic liveness endpoint.
- [ ] Web app can call the local API health endpoint.
- [ ] Worker boots and can connect to Redis without business queues.
- [ ] CI executes install/lint/typecheck/test/build.
- [ ] No business-domain feature is implemented early.
- [ ] Developer setup is documented.
- [ ] Demo seed command is guarded against accidental production execution.
- [ ] Minimal internal event mechanism adds no new runtime/broker and has a
      basic test.

## Stories

Create focused Stories before implementation if the Epic is split, for example:

- `FOUND-001` Workspace bootstrap
- `FOUND-002` API bootstrap
- `FOUND-003` Web bootstrap
- `FOUND-004` Worker bootstrap
- `FOUND-005` Local infrastructure
- `FOUND-006` CI

## Verification

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Implementation Notes

_To be updated by agent._

## Decisions / ADRs

- [[ADR-001 Modular Monolith]] (create during/after foundation if not present)

## Technical Debt

_None._
