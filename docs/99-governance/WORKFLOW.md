---
type: governance
status: active
updated: 2026-08-13
---

# Agent Development Workflow

## 1. Select work

Work on one Epic/Story at a time.

For implementation, prefer a Story ID.

Example:

```text
VET-004
```

## 2. Start

Run:

```text
/story-start VET-004
```

The agent must:

1. locate the Story;
2. read its acceptance criteria;
3. read linked PRD sections;
4. read linked ADRs;
5. inspect relevant modules;
6. check dependencies;
7. update Story to `in-progress`;
8. produce a concise implementation plan;
9. modify code only after context is understood.

## 3. Implement vertically

Recommended sequence:

```text
schema/migration
→ repository
→ service/domain logic
→ controller/API
→ authorization
→ tests
→ frontend
→ E2E when required
→ docs
```

Do not create all schemas for future Epics in advance.

## 4. Complexity Budget check

Before adding infrastructure/framework-level technology, compare the proposal to
the Complexity Budget in `AGENTS.md`.

If it crosses a listed boundary, create an ADR proposal before implementation.

Do not accept "future scalability" as sufficient justification without a
concrete requirement.

## 5. Unexpected architecture/scope issue

If a task exposes a missing decision:

```text
implementation
   ↓
conflict/question
   ↓
Decision Proposal
   ↓
smallest compatible path
```

Use:

```text
/decision <short title>
```

Do not rewrite PRD silently.

## 6. Verify

Use:

```text
/verify
```

The agent should inspect available scripts and execute the applicable
verification sequence.

Expected after bootstrap:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run focused integration/E2E tests for the current Story when defined.

## 7. Finish

Run:

```text
/story-finish VET-004
```

The Story must record:

- implementation summary;
- files/modules materially added;
- migrations;
- endpoints;
- permissions;
- tests;
- known limitations;
- linked Tech Debt;
- linked ADR/Decision;
- verification result.

Only then may status move to `done`.

## 8. Commit

Suggested shape:

```text
feat(VET-004): implement clinical encounter
```

Documentation belongs with the change.

## 9. New session recovery

At a fresh OpenCode session:

1. `AGENTS.md` provides persistent project rules.
2. The active Story provides current scope.
3. Linked docs provide domain context.
4. Git status/diff provide unfinished local work.
5. No conversational memory is required.

This is intentional: the project must be recoverable from repository state.
