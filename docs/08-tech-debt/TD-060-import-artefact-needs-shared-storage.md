---
id: TD-060
type: tech-debt
title:
  The browser lane has no shared object storage, so it cannot run an import end
  to end
status: resolved
severity: medium
owner: qa
related_epics:
  - "EPIC-19"
  - "EPIC-20"
related_stories:
  - "IMP-005"
related_decisions:
  - "DEC-072"
created: 2026-10-22
updated: 2026-10-22
---

# TD-060 — The lane cannot run a cross-process artefact

## What was found, and how

The first real run of `apps/e2e/specs/imports.spec.ts` in CI (PR #146) failed
twice, and the two failures are two different gaps:

```text
run 3976289183  imports-state: PREVIEWING ×8, then UPLOADED ×56
                → nothing consumed the queue at all

run 3976851290  imports-state: PREVIEWING ×8, then FAILED ×56
                → the consumer ran, and could not read the artefact
```

The first was fixed by having the spec spawn the worker, the way
`recovery.spec.ts` already does for the notification queue: the lane's
`webServer` starts only the API and the web app, and its `globalSetup` migrates
and seeds, so **no consumer runs in that lane unless a spec starts one**.

The second is this item. `StorageModule.forRoot()` wires the S3 driver only when
`STORAGE_S3_BUCKET` is present and otherwise falls back to
`InMemoryStorageDriver`. CI sets no `STORAGE_S3_*` at all, and
`docker-compose.yml` provides no object-storage service (the `.env.example`
documents the variables; nothing supplies them). So the API stores the uploaded
CSV in **its own process memory**, and the worker's in-memory driver — a
different process — is empty. The preview opens the artefact, finds nothing, and
fails the import.

## Why it matters beyond this test

Importing is asynchronous by [[DEC-072]]: the artefact is written by the API and
read by the worker. That makes shared object storage a **runtime dependency of
the feature**, not a testing convenience. A deployment that ran the API and the
worker with the in-memory driver would accept uploads and fail every one of
them, which is why `.env.example` already says `STORAGE_S3_BUCKET` is required
when `NODE_ENV=production`.

Nothing is wrong with the product code. What is missing is an environment that
looks like a deployment.

## Why it was not fixed inside EPIC-19

Providing it means adding a MinIO (or equivalent S3-compatible) service to
`docker-compose.yml` **and** a service container to `.github/workflows/ci.yml`,
plus the `STORAGE_S3_*` environment for the browser-lane job. That is
infrastructure, it cannot be verified from the environment this epic was built
in (no Docker), and it changes what the lane's job definition looks like — the
kind of change `.github/workflows/ci.yml` deserves on its own rather than buried
in a feature PR.

## What was done instead

`apps/e2e/specs/imports.spec.ts` is now **conditional rather than
aspirational**: the full-flow test runs when `STORAGE_S3_BUCKET` is set and
skips with this item named when it is not, and a second test proves the half the
lane CAN prove today — upload through the BFF, the row appearing in the history,
and the API accepting the preview — which is everything up to the artefact read.

## The trigger that would reopen it

Any of: [[EPIC-20]] Production Hardening; the first deployment that runs the
worker; the first time somebody needs the import flow proven in a browser.

## What a fix would touch

- `docker-compose.yml` — a MinIO service with a pre-created bucket.
- `.github/workflows/ci.yml` — a matching service container and the
  `STORAGE_S3_*` env for the browser-lane job (the `Database migrations` and
  live-PostgreSQL jobs would not need it).
- `apps/e2e/specs/imports.spec.ts` — drop the skip; the test already exists
  behind it.

## Resolution (2026-10-22, [[HARD-003]])

Closed by making object storage part of the environment contract, following
[[DEC-077]].

### What changed

```text
docker-compose.yml                     a MinIO service, with the same variable names
.github/workflows/ci.yml               a MinIO started as a step in the browser job
apps/e2e/support/storage-bucket.ts     reads STORAGE_S3_*, creates the bucket if missing
apps/e2e/global-setup.ts               calls it beside migrate and seed
apps/e2e/specs/imports.spec.ts         the full-flow test RUNS instead of skipping
.env.example                           names the multi-process requirement, not just production branding
docs/05-modules/Imports.md             records that the store must be shared
```

`ENGINEERING-RULES.md` already listed `object-storage` among the MVP deployables
and no code used it, so nothing architectural was introduced: MinIO is an
S3-compatible implementation of a boundary `packages/storage` already had, and
`S3StorageDriver` is used unchanged.

### Why a MinIO STEP in CI and not a `services:` entry

A GitHub Actions service container cannot override the image's command, and the
official MinIO image needs `server /data` to serve at all. The step runs
`docker run` explicitly, polls `/minio/health/live`, and prints the container's
logs on failure rather than timing out mutely.

### The three behaviours, verified

The bucket bootstrap has three paths and two of them were executed here:

```text
executed  STORAGE_S3_BUCKET unset            -> no-op with the reason stated
executed  configured but unreachable         -> THROWS, naming TD-060, refusing to
                                                fall back to the in-memory driver
executed  HEAD 404 then PUT, real AWS SDK    -> outcome "created", exactly one PUT
executed  HEAD 200, real AWS SDK             -> outcome "existing", zero PUTs
```

The last two used a stub S3 HTTP endpoint with the real `@aws-sdk/client-s3`, so
the control flow is proven with the SDK the product ships; only the MinIO server
itself is unexercised locally.

### What could NOT be verified in this environment, stated plainly

**There is no Docker in this environment and no MinIO binary, so the end-to-end
import flow against real shared storage was not executed here.** The
verification is therefore split:

```text
verified locally    compose parses; CI YAML parses; typecheck and lint pass;
                    the bucket bootstrap's four paths (above);
                    the lane still runs, and the full-flow test SKIPS with its
                    reason when storage is absent — the previous behaviour,
                    unchanged
verified in CI only the import actually crossing processes through a real bucket
```

That CI run is the closure evidence for this record, and it arrives with the
pull request. Until it is green, this resolution is **implemented but not proven
end to end**, and the epic closure says so.

### Recorded debt this resolution creates

`minio/minio:latest` is **unpinned**, in both `docker-compose.yml` and CI. MinIO
publishes release-stamped tags only (`RELEASE.<timestamp>`), so pinning requires
choosing a tag against the registry at the time of the change, which could not
be done offline here. Guessing a tag would have broken CI immediately, which is
worse than a recorded floating tag. Tracked as [[TD-061]].

[[TD-058]] is untouched: the artefact's 72-hour TTL still has no approved
retention policy behind it. Shared storage makes that limitation more visible,
not less.
