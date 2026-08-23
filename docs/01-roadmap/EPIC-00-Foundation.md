---
id: EPIC-00
type: epic
title: Foundation
status: done
priority: critical
depends_on: []
prd_sections:
  - "2"
  - "3"
  - "4"
created: 2026-08-13
updated: 2026-08-23
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

- [x] `pnpm install` succeeds from a clean checkout.
- [x] Workspace layout matches PRD.
- [x] TypeScript strict configuration is shared.
- [x] `pnpm lint` succeeds.
- [x] `pnpm typecheck` succeeds.
- [x] `pnpm test` has a valid baseline and succeeds.
- [x] `pnpm build` succeeds.
- [x] Local PostgreSQL and Redis can start from documented commands.
- [x] API provides a basic liveness endpoint.
- [x] Web app can call the local API health endpoint.
- [x] Worker boots and can connect to Redis without business queues.
- [x] CI executes install/lint/typecheck/test/build.
- [x] No business-domain feature is implemented early.
- [x] Developer setup is documented.
- [x] Demo seed command is guarded against accidental production execution.
- [x] Minimal internal event mechanism adds no new runtime/broker and has a
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

Stories were tracked as SDD change folders rather than separate story files:
`openspec/changes/epic-00-foundation/` (implemented) and
`openspec/changes/foundation-readiness/`.

### Verification evidence

- Full root gates (`lint`, `format-check`, `typecheck`, `test`, `build`) exited
  0; see `docs/10-qa/CI-EVIDENCE.md` and
  `openspec/changes/epic-00-foundation/verify-report.md`.
- Live Compose probes passed: PostgreSQL persistence across restart, Redis
  reachability, named non-zero preflight failures.
- Worker graceful shutdown (SIGTERM/SIGINT, single-run dedup, rejection logging
  with non-zero exit) is covered by automated tests in
  `apps/worker/src/main.test.ts` via the extracted `installSignalShutdown`
  helper (closeout change, 2026-08-23).
- Closeout verification returned PASS-WITH-AUTHORIZED-DEFERRALS (11/11
  requirements, 19/19 scenarios evidence-resolved); see
  `openspec/archive/2026-08-23-epic-00-closeout-and-archive/verify-report.md`.
  Epic closed `done` under maintainer closure authorization dated 2026-08-23,
  with deferred slices preserved as Known limitations below.

### Known limitations (deferred closeout evidence)

Maintainer authorization dated 2026-08-23 deferred two EPIC-00 closeout evidence
slices to explicit Tech Debt records instead of blocking the foundation
baseline:

- Branch-protection verification/configuration for `main` could not be
  performed: no GitHub admin/API authority available. Tracked as [[TD-001]];
  until resolved, CI is green but not merge-blocking.
- Executable Windows preflight evidence could not be captured: PowerShell 7
  absent locally and `preflight.ps1` requires >= 7.2. Tracked as [[TD-002]].

The documentation-authority decision is proposed as [[DEC-001]] and awaits
maintainer acceptance.

## Decisions / ADRs

- [[ADR-001 Modular Monolith]]
- [[ADR-003 Minimal Internal Application Events]]
- [[DEC-001]] — documentation authority and OpenSpec trace policy (proposed)

## Technical Debt

- [[TD-001]] — verify and configure `main` branch protection.
- [[TD-002]] — capture executable PowerShell preflight evidence.
