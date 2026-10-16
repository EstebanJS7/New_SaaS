---
id: TD-038
type: tech-debt
title:
  The schema gate's test copies a directory under a five-second default timeout
status: open
severity: low
owner: fiscal
created: 2026-10-15
updated: 2026-10-15
related:
  - FISC-008
---

# TD-038 — the schema gate's copied directory and the default timeout

**It failed one CI run and passed on the next, which is the definition of the
problem.** `packages/fiscal/src/dte/xsd-validation.test.ts` copies the whole
official schema directory into a temporary one with
`await cp(schemaDirectory, directory, { recursive: true })` around line 230, and
its cases inherit vitest's **five-second default timeout**. On a CI runner whose
filesystem is slower than a developer's, that copy can exceed the default, and
the job that exists to prove the runtime XSD gate works reports
`Test timed out in 5000ms` instead.

It was observed during [[EPIC-16]]'s closure: PR #124's `DTE XSD validation` job
went red on that timeout with `1 failed | 786 passed`, while the same tree's
`Lint, Typecheck, Test, Build` job — and every earlier run of that job — was
green on the same file.

**Why it matters more than a flake usually does.** This is the epic's own second
acceptance criterion: "A DTE XML validates against the official XSD before any
submission". A gate that goes red for a reason unrelated to what it gates
teaches its reader to re-run it, and a re-runnable red gate is how a real red
one gets ignored.

**The fix**: give the copy an explicit timeout — the pattern the repository
already uses for its twenty- and thirty-second cases — or hoist it into a
`beforeAll` so one copy serves every case instead of one per test.
