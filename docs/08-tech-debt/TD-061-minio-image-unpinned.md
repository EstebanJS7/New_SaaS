---
id: TD-061
type: tech-debt
title:
  The MinIO image moved registries: minio/minio is no longer pullable and the lane
  uses the Bitnami packaging
status: resolved
severity: low
owner: qa
related_epics:
  - "EPIC-20"
related_stories:
  - "HARD-003"
related_decisions:
  - "DEC-077"
created: 2026-10-22
updated: 2026-10-22
---

# TD-061 — The MinIO image is unpinned

## What was deferred

[[HARD-003]] added `minio/minio:latest` to `docker-compose.yml` and to the CI
browser job's object-storage step, so the asynchronous import can cross a
process boundary and [[TD-060]] closes.

The tag is `latest` in both places.

## Why it was deferred

MinIO publishes release-stamped tags in the form `RELEASE.<timestamp>` and no
moving major tag. Pinning therefore requires choosing a stamp against the
registry at the time of the change. That could not be done in the environment
that made this change — no Docker, no network access to the registry — and
inventing a stamp would have broken CI immediately, which is a worse outcome
than a recorded floating tag.

## Risk

A MinIO release can change the S3 API surface, its health endpoint, or its
credential requirements between runs. The failure would appear in the browser
job as an import that cannot read its artefact, which reads like a product
defect rather than an image change.

The blast radius is bounded: MinIO is only used by the browser lane and by local
development. No production deployment depends on this compose file, because
production storage is the hosting provider's.

## Proposed Resolution

1. Pick a current `RELEASE.<timestamp>` tag and pin it in **both**
   `docker-compose.yml` and `.github/workflows/ci.yml`, in the same commit, so
   the two declarations cannot drift — the drift risk [[DEC-077]] already named.
2. Record the chosen tag and its date in `docs/05-modules/Imports.md`.
3. Add the image to whatever dependency-update process the repository adopts; a
   pinned image nobody bumps becomes a stale one nobody notices.

## Trigger / Target

The first time the browser job fails on an object-storage step whose cause is
the image rather than the code, or the first dependency-pinning pass over the
repository, whichever comes first.

## Verification After Resolution

- [ ] `docker-compose.yml` and `.github/workflows/ci.yml` name the same
      `RELEASE.<timestamp>` tag.
- [ ] The browser lane is green with the pinned tag.
- [ ] The chosen tag and the date it was chosen are recorded in the Imports
      module documentation.

## Resolution (2026-10-22) — the risk was real, and it was not "unpinned"

The first CI run of this epic's pull request (**run `39797636546`**, job
`Browser end-to-end`) failed before the lane started:

```text
Unable to find image 'minio/minio:latest' locally
docker: Error response from daemon: pull access denied for minio/minio,
  repository does not exist or may require 'docker login'
```

So the defect was never the floating tag. **The repository is gone.** A direct
registry query confirms it:

```text
hub.docker.com/v2/repositories/minio/minio/            -> 404  "object not found"
registry-1.docker.io/v2/minio/minio/manifests/latest    -> 401 (repository absent)
hub.docker.com/v2/repositories/bitnamilegacy/minio/    -> 200
registry-1.docker.io/v2/bitnamilegacy/minio/manifests/latest -> 200
hub.docker.com/v2/repositories/bitnami/minio/          -> 200 repo, 404 for :latest
```

MinIO moved its free images off Docker Hub, and `bitnami/minio` no longer
publishes `latest` — its free tags are on `bitnamilegacy/minio`.

Recording this accurately matters: the assumption behind this record was
"choosing a stamp needs the registry, which is unreachable here". The registry
was reachable; the _image_ was not, and no tag of it would have worked.

### What changed

```text
docker-compose.yml     image bitnamilegacy/minio:latest
                       no `command:` override (Bitnami runs `minio server` itself)
                       MINIO_DEFAULT_BUCKETS pre-creates the bucket
                       volume at /bitnami/minio/data, where this image expects it
.github/workflows/ci.yml
                       a `minio` SERVICE CONTAINER, not a `docker run` step
                       same three variables, no `--health-cmd`
apps/e2e/support/storage-bucket.ts
                       ensureBucketWhenReady polls up to 60s before failing
```

### The three decisions inside the fix

1. **A service container instead of a step.** GitHub starts a job's steps
   without waiting for a service unless a health check is declared, and a
   service container cannot override an image's command — which is why the
   previous version needed a step. Bitnami's image needs no command, so the
   service form works and is simpler.
2. **No `--health-cmd`.** A health command depends on a binary being present in
   an image that is not this repository's contract; if it is missing the service
   waits forever and the job fails for a reason nobody can read. Readiness moved
   into the lane, where the code that cares about it lives.
3. **`ensureBucketWhenReady` polls.** The bootstrap now tolerates a container
   that is still starting, and a store that never arrives fails **naming the
   deadline** rather than with a connection error from a race.

### What is still unpinned, and why that is now the smaller risk

`bitnamilegacy/minio:latest` is a floating tag on a registry explicitly labelled
_legacy_, so the image can disappear the same way the original did. Pinning does
not help — a pinned tag in a deleted repository fails exactly as `latest` did.

The real mitigation is that the lane no longer depends on the image being
current: `packages/storage` speaks S3, so any S3-compatible server satisfies it,
and the failure mode is now a named one (the bucket bootstrap's deadline) rather
than an opaque pull error. If this image disappears, the replacement is a
one-line change to two files, and this record is the map for it.

### Verification after resolution

- [x] `docker-compose.yml` and `.github/workflows/ci.yml` name the same image
      and the same variable names.
- [x] Both files parse (`yaml.safe_load`).
- [x] The image's `latest` manifest answers 200 on the registry the job pulls
      from.
- [x] The bootstrap tolerates a slow start and fails naming the deadline.
- [ ] The browser lane is green with the new image — **PENDING the next CI
      run.**
