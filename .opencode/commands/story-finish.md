---
description: Verify and close a Story only when its completion gates pass
---

Finish work on `$1`.

1. Locate Story/Epic `$1`.
2. Read its acceptance criteria and implementation notes.
3. Inspect git diff and changed files.
4. Run the applicable repository verification:
   - lint
   - typecheck
   - unit tests
   - integration tests required by the work item
   - build
   - E2E tests required by the work item
5. Do not hide failing checks.
6. Reconcile documentation with the actual implementation:
   - migrations
   - endpoints
   - permissions
   - domain invariants
   - UI behavior
   - tests
   - known limitations
   - related ADRs/Decisions
   - technical debt
7. Any deferred issue that breaks an acceptance criterion means the item is NOT
   Done.
8. If every required gate passes, check completed acceptance boxes and set
   `status: done`.
9. Otherwise leave/set `status` to `in-progress`, `blocked` or `review` and
   clearly record why.
10. Update `docs/01-roadmap/ROADMAP.md` when an Epic status materially changes.
11. Update `docs/09-releases/CHANGELOG.md` when the change is user-visible.
12. Summarize exactly what passed, what failed and what remains.
