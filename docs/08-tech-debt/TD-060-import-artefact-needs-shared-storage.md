---
id: TD-060
type: tech-debt
title:
  The browser lane has no shared object storage, so it cannot run an import end
  to end
status: open
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
