---
id: ADR-003
type: adr
title: Minimal Internal Application Events
status: accepted
date: 2026-08-13
supersedes: []
superseded_by:
related_epics:
  - EPIC-00
  - EPIC-07
  - EPIC-12
  - EPIC-14
  - EPIC-15
  - EPIC-17
---

# ADR-003 — Minimal Internal Application Events

## Context

The reusable Core needs limited decoupling between completed business operations
and secondary reactions such as notifications or projections.

A distributed event platform would add unnecessary complexity, while direct
cross-module calls for every secondary concern would increase coupling.

## Decision

Allow minimal internal post-commit application events.

Transactional invariants remain explicit synchronous application-service
orchestration.

Use BullMQ only when durable/retryable asynchronous processing is actually
required.

Do not introduce a distributed/general event bus in the MVP.

## Alternatives

### Direct calls for everything

Simple initially but couples secondary reactions tightly.

### Distributed event broker

Rejected for MVP due to operational and consistency complexity.

### Event sourcing

Rejected. The product does not require event-sourced aggregates.

## Consequences

Positive:

- clean decoupling for secondary reactions;
- no new runtime infrastructure;
- compatible with modular monolith;
- preserves transactional clarity.

Negative:

- developers must distinguish transactional behavior from post-commit behavior;
- event misuse could hide domain dependencies.

## Guardrails

See [[Internal Events]] and the Complexity Budget in `AGENTS.md`.
