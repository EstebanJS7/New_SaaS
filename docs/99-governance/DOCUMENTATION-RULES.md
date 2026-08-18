---
type: governance
status: active
owner: engineering
updated: 2026-08-13
---

# Documentation Rules

`docs/` is both technical documentation and an Obsidian Vault.

## Principle

Git is the storage/version-history layer. Obsidian is the human interface over
Markdown.

Do not create a second project truth in an external wiki unless explicitly
required.

## Required metadata

Epics, Stories, ADRs, Decisions, Bugs and Tech Debt must contain YAML
frontmatter.

Dates use:

```text
YYYY-MM-DD
```

IDs are stable and never reused.

## Status vocabularies

### Epic / Story

```text
planned
ready
in-progress
blocked
review
done
cancelled
```

### ADR

```text
proposed
accepted
rejected
superseded
```

### Decision

```text
proposed
accepted
rejected
superseded
```

### Bug

```text
open
in-progress
ready-for-verification
closed
wont-fix
```

### Technical Debt

```text
open
accepted
scheduled
resolved
wont-fix
```

## Story completion

A Story can only become `done` if:

- all required acceptance criteria are checked;
- required migrations exist;
- permissions are enforced;
- tenant isolation is covered where applicable;
- lint/typecheck/tests required by the Story pass;
- implementation summary is updated;
- technical debt/known limitations are recorded.

If verification fails, use `in-progress`, `blocked` or `review`.

## PRD changes

Agents MUST NOT edit approved scope in `00-product/PRD.md` merely because
implementation would be easier.

Create a Decision proposal instead.

A PRD edit requires an explicit approved decision or user instruction.

## ADR vs Decision

Use an ADR when the change is architectural and expected to remain true across
features.

Examples:

- change ORM;
- change authentication strategy;
- change tenancy model;
- introduce event bus;
- change Fiscal Provider boundary.

Use a Decision when the choice is product/implementation-specific but not
necessarily architectural.

Examples:

- default appointment collision mode;
- portal booking approval behavior;
- rollout choice for a feature.

## Technical Debt

Technical Debt is not a dumping ground for unfinished acceptance criteria.

If an acceptance criterion is required now and is missing, the Story is not
Done.

Use Tech Debt for explicitly deferred quality/maintainability improvements that
do not invalidate current acceptance.

## Links

Prefer Obsidian links for internal knowledge:

```text
[[ADR-001 Modular Monolith]]
[[VET-004 Clinical Encounter]]
```

Also include concrete file paths in sections used by coding agents when
ambiguity is possible.

## Code/docs atomicity

When documentation describes a code behavior changed in the current task, update
both in the same commit/PR whenever practical.

## Architecture freeze

PRD v1.3 is the frozen MVP architecture baseline.

Do not edit the PRD to normalize an implementation deviation.

If a structural change is required, create an ADR proposal and keep the PRD
unchanged until that ADR/decision is explicitly accepted.

## Data-handling documentation

When a Story introduces new sensitive fields or exports, document relevant
classification/portal/logging/retention behavior in the Story or module
documentation.
