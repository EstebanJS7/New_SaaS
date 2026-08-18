---
description:
  Reconcile repository documentation with current code and git changes
---

Synchronize documentation with the current implementation without changing
product scope.

1. Read `git status` and `git diff`.
2. Identify changed domains/APIs/schema/permissions/jobs/UI behaviors.
3. Locate related Story and module docs.
4. Update documentation only for behavior that is actually implemented.
5. Do not modify approved PRD scope unless backed by an accepted Decision or
   explicit user instruction.
6. If code differs from approved architecture unexpectedly:
   - do not normalize the PRD to match;
   - surface the conflict;
   - create/propose a Decision or ADR.
7. Record new technical debt explicitly.
8. Update changelog only for notable user-visible behavior.
9. Report documentation changed and any unresolved inconsistencies.
