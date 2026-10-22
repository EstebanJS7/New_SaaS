---
id: DEC-077
type: decision
title:
  Shared object storage becomes part of the environment contract, so the browser
  lane can run a complete import
status: accepted
date: 2026-10-22
related_epics:
  - "EPIC-19"
  - "EPIC-20"
related_decisions:
  - "DEC-072"
related_stories:
  - "HARD-003"
prd_change_required: false
---

# DEC-077 — MinIO in the environment contract, and the import spec stops skipping

## Context

`ENGINEERING-RULES.md` lists `object-storage` among the MVP deployables. No code
used it until [[EPIC-19]], and the environment never reflected it:
`docker-compose.yml` declares `postgres` and `redis` and nothing else, and
`.github/workflows/ci.yml` gives the browser job a PostgreSQL and a Redis
service container and no storage.

`packages/storage` wires S3 only when `STORAGE_S3_BUCKET` is present and
otherwise falls back to `InMemoryStorageDriver`, **per process**. That fallback
is correct for unit tests and actively wrong for an asynchronous flow: the API
writes the uploaded artefact into its own memory, the worker boots in a
different process, and the artefact does not exist there.

That is [[TD-060]], and it produced a visible consequence at [[EPIC-19]]'s
closure. The import spec exists, the full flow is written, and it **skips** with
the reason named, because the lane cannot get an artefact from the API's process
into the worker's. The half the lane can reach — the multipart proxy, the
surface, the queue, the claim and the worker's boot — is proven by a second test
that observes the state leaving `UPLOADED`.

So the product ships a promise it cannot demonstrate end to end: PRD §32 says
large imports run asynchronously with a preview and a result summary, and no
gate in this repository has ever seen the preview produce an outcome.

## Question

Does the environment gain a shared object store now, and if so, in which
environments?

## Options

**A. MinIO in `docker-compose.yml` and as a CI service container for the browser
job,** with the bucket created at startup and `STORAGE_S3_*` wired to it. The
import spec drops its skip and runs the full flow.

**B. MinIO in `docker-compose.yml` only.** Local development gains shared
storage; CI does not, because the browser job would have to grow a service
container and a bucket bootstrap step. The skip stays.

**C. No storage in either.** [[TD-060]] stays open, the skip stays, and the
asynchronous flow stays unproven end to end.

## Decision

**A.**

1. **MinIO joins `docker-compose.yml`** with a health check and a bucket
   bootstrap, matching the shape `postgres` and `redis` already have. It is the
   S3-compatible implementation of a boundary that already exists in
   `packages/storage` (`S3StorageDriver` already accepts an `endpoint` and names
   MinIO in its own comment), so this is not a new technology entering the
   stack.
2. **The CI browser job gets the same service**, with the same bucket, so the
   lane runs the built apps against a storage contract a deployment could
   actually satisfy. A lane that proves a flow against an in-memory driver would
   be proving a different product.
3. **The import spec runs the whole flow.** Upload, preview with per-row
   outcomes, commit, and the result summary — driven from the browser, with a
   worker the spec spawns the way `recovery.spec.ts` already does. The skip is
   removed, not narrowed.
4. **The fallback stays.** `InMemoryStorageDriver` remains the default when
   `STORAGE_S3_BUCKET` is absent, because unit tests and single-process
   integration tests depend on it and it is honest about what it is. What
   changes is that **every environment which runs more than one process now sets
   the bucket**, and that is recorded in the environment documentation rather
   than left to be discovered.
5. **No new production dependency for the app.** The `@aws-sdk/client-s3` client
   already exists; MinIO speaks the same protocol.

## Consequences

- [[TD-060]] closes with its trigger satisfied, and PRD §32's asynchronous
  promise gains end-to-end evidence for the first time. The browser lane's skip
  count drops to zero or to only unrelated, explicitly-reasoned skips — the
  closure records the exact number it observes.
- The CI browser job grows a service container and a startup step, so the lane
  gets slightly slower and has one more thing that can fail. That cost buys the
  only end-to-end coverage of an asynchronous product flow in the repository.
- `.github/workflows/ci.yml` remains the only place the service is declared for
  CI, so `docker-compose.yml` and CI can drift. The mitigation is that both are
  asserted to carry the same variable names, and the spec fails loudly if the
  bucket is missing rather than silently falling back.
- [[TD-058]] is untouched: the artefact has a 72-hour TTL and **no approved
  retention policy behind it**. Shared storage makes that limitation more
  visible, not less, and it stays open.
