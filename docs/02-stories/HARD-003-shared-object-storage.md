---
id: HARD-003
type: story
title: Shared object storage in the environment contract
epic: EPIC-20
status: planned
priority: high
depends_on: []
prd_sections:
  - "25"
  - "29"
  - "32"
permissions: []
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# HARD-003 — Shared object storage in the environment contract

## Objective

Put the `object-storage` deployable that `ENGINEERING-RULES.md` already lists
into the environment contract, so an asynchronous import can cross a process
boundary. Closes [[TD-060]], and makes the browser lane run a complete import
for the first time. [[DEC-077]] fixes the scope.

## Context

`packages/storage` wires `S3StorageDriver` only when `STORAGE_S3_BUCKET` is
present and otherwise falls back to `InMemoryStorageDriver`, **per process**.
`docker-compose.yml` declares `postgres` and `redis` only, and the CI browser
job provisions those two and no storage.

The consequence was visible at [[EPIC-19]]'s closure: the API writes the
uploaded artefact into its own memory, the worker boots in a different process,
the artefact is not there, and the import spec **skips** with TD-060 named. PRD
§32's asynchronous promise — validation, preview, result summary — has never
been observed end to end by any gate.

The lane's other constraint is already solved by precedent: `webServer` starts
only the API and the web app, so a spec that needs a queue consumer spawns the
worker itself, the way `apps/e2e/specs/recovery.spec.ts` does.

## Acceptance Criteria

- [ ] `docker-compose.yml` gains a MinIO service with a health check and a
      bucket bootstrap, matching the shape of the `postgres` and `redis`
      entries.
- [ ] `.github/workflows/ci.yml` gives the browser job a MinIO service container
      and creates the bucket before the lane runs.
- [ ] The browser job sets the `STORAGE_S3_*` variables the storage module
      reads, and `docker-compose.yml` and CI use the **same names**.
- [ ] `apps/e2e/specs/imports.spec.ts` runs the complete flow — upload, preview
      with per-row outcomes, commit, result summary — with no skip for TD-060.
- [ ] The spec spawns the worker and kills it in `afterAll`, following
      `recovery.spec.ts`.
- [ ] A missing bucket fails loudly in the lane instead of silently falling back
      to in-memory, so the fallback cannot mask a broken configuration.
- [ ] The environment documentation states that every multi-process environment
      must set `STORAGE_S3_BUCKET`, and why.
- [ ] The exact skip count the lane observes is recorded (expected: zero skips
      attributable to TD-060).

## Verification

```text
pnpm format-check && pnpm lint && pnpm typecheck && pnpm build
pnpm --filter @newsaas/e2e test
```

Docker is unavailable in this environment, so the compose file is validated by
schema/parse and the CI path is the executed evidence.

## Technical Debt / Limitations

- [[TD-058]] is untouched: the artefact has a 72-hour TTL and no approved
  retention policy behind it. Shared storage makes that more visible, not less.
- Two declarations of the same service (compose and CI) can drift. The shared
  variable names and the fail-loud behaviour are the mitigation.
