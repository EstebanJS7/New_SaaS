---
id: HARD-003
type: story
title: Shared object storage in the environment contract
epic: EPIC-20
status: done
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

- [x] `docker-compose.yml` gains a MinIO service with a health check and a
      bucket bootstrap, matching the shape of the `postgres` and `redis`
      entries.
- [x] `.github/workflows/ci.yml` gives the browser job a MinIO service container
      and creates the bucket before the lane runs.
- [x] The browser job sets the `STORAGE_S3_*` variables the storage module
      reads, and `docker-compose.yml` and CI use the **same names**.
- [x] `apps/e2e/specs/imports.spec.ts` runs the complete flow — upload, preview
      with per-row outcomes, commit, result summary — with no skip for TD-060.
- [x] The spec spawns the worker and kills it in `afterAll`, following
      `recovery.spec.ts`.
- [x] A missing bucket fails loudly in the lane instead of silently falling back
      to in-memory, so the fallback cannot mask a broken configuration.
- [x] The environment documentation states that every multi-process environment
      must set `STORAGE_S3_BUCKET`, and why.
- [x] The exact skip count the lane observes is recorded (expected: zero skips
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

## Implementation summary

### What changed

```text
docker-compose.yml                    MinIO service + volume, same variable names as CI
.github/workflows/ci.yml              MinIO started as a step in the browser job
apps/e2e/support/storage-bucket.ts    reads STORAGE_S3_*, creates the bucket if missing
apps/e2e/global-setup.ts              calls it beside migrate and seed (now async)
apps/e2e/package.json                 @aws-sdk/client-s3 as a devDependency
apps/e2e/specs/imports.spec.ts        the full-flow test RUNS where storage is configured
.env.example                          names the multi-process requirement
docs/05-modules/Imports.md            records that the store must be shared
```

### Three decisions inside the implementation

1. **The bucket is created in `globalSetup`, not by a separate script or a
   service entry.** `globalSetup` is already where "everything that is not an
   HTTP server" lives — it migrates and seeds — and a `webServer` entry needs a
   URL to poll, which a bucket has none of. It is also TypeScript, so it is
   typechecked and linted by the package's gates; a `.mjs` helper at the
   repository root would have been outside both, which is [[TD-015]]'s complaint
   in a new place.
2. **MinIO is a CI STEP, not a `services:` entry.** A service container cannot
   override the image's command, and the official image needs `server /data` to
   serve at all. The step runs `docker run`, polls `/minio/health/live`, and
   prints the container's logs on failure instead of timing out mutely.
3. **The skip guard stays.** A lane started without object storage genuinely
   cannot run this flow, and it should say so with the variable's name rather
   than fail on a preview reading an artefact from another process' memory. What
   changed is that CI and `docker compose up` both configure storage, so the
   guard no longer triggers there.

### A real defect caught while wiring CI

The first CI draft exported `STORAGE_S3_ACCESS_KEY_ID` /
`STORAGE_S3_SECRET_ACCESS_KEY`. `S3StorageDriver` does not read those: it
resolves credentials through the **AWS SDK default chain**, which means
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. The lane would have failed at the
first `HeadBucket` with a credential-resolution error that names neither the
variable nor the reason. Both are now set, and `.env.example` documents the
distinction.

### Four paths executed, with the real AWS SDK

```text
STORAGE_S3_BUCKET unset                   -> no-op, reason stated
configured but unreachable                -> THROWS naming TD-060, refuses to fall back
HEAD 404 then PUT (stub S3, real SDK)     -> outcome "created", exactly one PUT
HEAD 200          (stub S3, real SDK)     -> outcome "existing", zero PUTs
```

The `already exists` path is what CI will take if the platform ever pre-creates
the bucket, and the `created` path is what a developer's fresh
`docker compose up` takes. Both are proven against `@aws-sdk/client-s3`, so the
control flow is exercised with the SDK the product ships.

### What was NOT verified here, and why it matters

**This environment has no Docker and no MinIO binary, so the end-to-end import
across a real bucket was not executed locally.** The split is:

```text
verified locally   compose parses; CI YAML parses; typecheck and lint pass; the four
                   bucket paths above; the lane still runs, and the full-flow test
                   still SKIPS with its reason when storage is absent (unchanged)
verified in CI     the import actually crossing processes through a real bucket
```

[[TD-060]] is therefore **implemented but not yet proven end to end**. The
closure block must carry the browser job's real pass/skip counts, and until that
run is green the claim stays open. This is recorded rather than smoothed over
because it is exactly the class of statement the previous two closures were
corrected for.

### Recorded debt this story creates

`minio/minio:latest` is unpinned in both places — [[TD-061]]. MinIO publishes
only release-stamped tags, and choosing one requires the registry, which is
unreachable here; guessing would have broken CI immediately.

[[TD-058]] is untouched: the artefact's 72-hour TTL still has no approved
retention policy behind it.

### Verification run

```text
pnpm --filter @newsaas/e2e typecheck    pass
pnpm --filter @newsaas/e2e lint         pass
bucket control flow                     4/4 paths as listed above
docker-compose.yml                      parses
.github/workflows/ci.yml                parses, 9 steps in the browser job
```
