---
id: ADR-001
type: adr
title: Modular Monolith
status: accepted
date: 2026-08-13
supersedes: []
superseded_by:
related_epics:
  - EPIC-00
---

# ADR-001 — Modular Monolith

## Context

The initial product must be fast to build with coding agents while supporting
multiple business domains and future verticals.

Microservices would add deployment, networking, distributed consistency and
observability complexity before product-scale needs justify it.

## Decision

Use a modular monolith with three deployables:

```text
web
api
worker
```

The API contains explicit module/domain boundaries. Slow/external operations run
in the worker through queues.

## Consequences

Positive:

- simpler local development;
- simpler transactions;
- fewer deployment units;
- predictable structure for coding agents;
- modules can later be extracted if measured requirements justify it.

Negative:

- boundaries are enforced by code conventions/tests rather than network
  boundaries;
- careless imports can create coupling.

## Guardrails

Core must not import Veterinary implementation details.

No new microservice may be introduced without a superseding accepted ADR.
