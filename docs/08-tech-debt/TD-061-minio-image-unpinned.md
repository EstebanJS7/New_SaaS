---
id: TD-061
type: tech-debt
title: The MinIO image is unpinned in docker-compose and in CI
status: open
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
