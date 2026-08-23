---
id: DEC-001
type: decision
title: Documentation authority and OpenSpec trace policy
status: accepted
date: 2026-08-23
related_epics:
  - EPIC-00
related_stories: []
prd_change_required: false
---

# DEC-001 — Documentation authority and OpenSpec trace policy

## Context

The repository currently holds two overlapping documentation surfaces:

- `docs/` — product PRD, roadmap epics/stories, ADRs, Decisions, module docs, QA
  evidence, governance rules; consumed by humans and coding agents.
- `openspec/` — SDD change folders (`proposal.md`, `design.md`, `specs/`,
  `tasks.md`) produced by the Spec-Driven Development workflow while a change is
  being implemented.

Without a declared authority rule, agents and maintainers risk treating OpenSpec
change folders as a second source of truth, which drifts from `docs/` once a
change is implemented and archived.

## Question

Which surface is the permanent documentation source of truth, what role do
active OpenSpec change folders play, and under what condition may an OpenSpec
change folder be archived?

## Options

### Option A — `docs/` is permanent truth; OpenSpec is temporary trace

`docs/` remains the single permanent source of truth for intent, architecture,
and behavior. OpenSpec change folders are temporary SDD working artifacts whose
content must land in `docs/` (stories, decisions, evidence) before archive;
archived folders are immutable audit trail only.

### Option B — Dual sources of truth

Keep `openspec/` as a co-equal documentation surface with its own standing
specification tree, synced bidirectionally with `docs/`.

## Recommendation

Option A. A dual-source model (Option B) requires continuous synchronization,
guarantees eventual divergence, and doubles review surface for no reader
benefit. OpenSpec folders exist to make one change reviewable and verifiable;
their useful outcomes belong in `docs/` before they are archived.

## Impact

### Product

None. No approved scope changes.

### Architecture

Declares that architectural truth lives in accepted ADRs and module docs under
`docs/`. SDD delta specs describe candidate behavior only until the change is
verified and archived.

### Database/API

None.

### Delivery

Defines when an OpenSpec change folder may be archived:

> **Archive trigger**: an OpenSpec change folder MAY be archived only after all
> of its closeout gates are verified with recorded evidence, AND every blocker
> is either resolved or formally deferred into a tracked record under
> `docs/08-tech-debt/` (or superseding governance) with maintainer authorization
> dated in the change state. Archived folders move intact to
> `openspec/archive/<YYYY-MM-DD>-<change>/`; nothing is deleted.

Deferred-but-documented work never silently disappears: it reappears as Tech
Debt or Story records in `docs/`.

## Decision

**Accepted by the maintainer on 2026-08-23.** Option A is adopted:

1. `docs/` is the permanent source of truth for intent, architecture, and
   behavior.
2. OpenSpec change folders are temporary SDD working artifacts; once archived
   they are immutable audit trail only.
3. The archive trigger defined under Impact > Delivery governs when a change
   folder may move to `openspec/archive/`.

## PRD Update

None. This decision does not alter approved product scope; it governs repository
documentation workflow only.
