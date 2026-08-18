---
description:
  Run the applicable quality gates and report failures without hiding them
---

Verify the current repository state.

1. Inspect `package.json`, workspace config and scripts before assuming command
   names.
2. Run the available equivalents of:
   - lint
   - typecheck
   - unit tests
   - integration tests
   - build
3. If the current Story defines critical E2E tests, run them.
4. Do not modify tests merely to make them pass unless they are demonstrably
   incorrect and the change preserves approved behavior.
5. If any command fails:
   - identify the root cause;
   - fix implementation when safe and in scope;
   - rerun the failing gate;
   - report unresolved failures.
6. Return a concise table of gates and results.
