---
id: TD-058
type: tech-debt
title: The uploaded import artefact has no retention policy
status: open
severity: medium
owner: backend
related_epics:
  - "EPIC-19"
related_stories:
  - "IMP-001"
related_decisions:
  - "DEC-072"
created: 2026-10-19
updated: 2026-10-19
---

# TD-058 — The import artefact's retention

## What was deferred

[[DEC-072]] decided the uploaded file is stored once and both the preview and
the commit read that same artefact, which is what makes "commit what you saw" a
structural guarantee rather than a convention.

That leaves an object in storage containing a tenant's customer list — names,
phone numbers, e-mail addresses, possibly tax identifiers. [[IMP-001]] deletes
it when the import reaches a terminal state, and states a TTL for an import that
never does. What this item records is that **there is no approved retention
policy behind that choice**.

`docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md` forbids implementing
automatic destructive retention for clinical, fiscal or audit records until an
explicit policy exists. A customer list is not one of those, which is why a TTL
is defensible here — but the policy it should be consistent with still does not
exist.

## Why it was deferred

It is not a decision this epic can make. The classification (INTERNAL) and the
TTL are [[IMP-001]]'s; the policy that would validate them is a product decision
that applies to every future artefact, not just this one.

## The trigger that would reopen it

[[EPIC-20]] Production Hardening, or the first approved retention policy
document, or a tenant asking where its uploaded files go.

## What a fix would touch

- The retention policy document, and then [[IMP-001]]'s TTL and its cleanup job
  if the policy disagrees with them.
- Possibly `packages/storage`, if the policy distinguishes buckets by
  classification.
