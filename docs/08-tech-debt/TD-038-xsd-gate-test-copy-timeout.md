---
id: TD-038
type: tech-debt
title:
  The schema gate's test has no budget of its own, and vitest's default timed it
  out once
status: done
severity: low
owner: fiscal
created: 2026-10-15
updated: 2026-10-15
related:
  - FISC-008
---

# TD-038 — the schema gate's test and the default it inherited

**It failed one CI run and passed on the next, which is the definition of the
problem.** `packages/fiscal/src/dte/xsd-validation.test.ts` reported
`Test timed out in 5000ms` for the case at line 230 — "compiles the official
schema once per process" — and its cases inherit vitest's **five-second default
timeout**, which `packages/vitest-config/vitest.node.ts` does not override.

It was observed during [[EPIC-16]]'s closure: PR #124's `DTE XSD validation` job
went red on that timeout with `1 failed | 786 passed`, while the same tree's
`Lint, Typecheck, Test, Build` job — and every earlier run of that job — was
green on the same file. The re-run passed in 38 s.

**What the measurement says, because the first reading was wrong.** The obvious
diagnosis is that the case's
`cp(schemaDirectory, directory, { recursive: true })` is what exceeded the
default. It is not: with the official schemas present those two cases take **101
ms and 77 ms**, and the whole file runs in **2.54 s** — a fiftieth of the
default, not a fifth over it. So the copy alone does not explain the failure,
and this record should not claim it does.

What the case actually does is filesystem I/O over a directory of official
schemas **plus a native `libxml2` compile** against them, and a loaded CI runner
can make that arbitrarily slower than a laptop. The honest reading is therefore:
the failure is real and was not reproduced, the **default is what made it
possible**, and the fix is the headroom rather than the theory.

**Why it matters more than a flake usually does.** This is the epic's own second
acceptance criterion: "A DTE XML validates against the official XSD before any
submission". A gate that goes red for a reason unrelated to what it gates
teaches its reader to re-run it, and a re-runnable red gate is how a real red
one gets ignored.

**Fixed** on `fix/fisc-008-xsd-gate-test-timeout`: the two cases that copy the
directory carry an explicit `COPY_CASE_TIMEOUT_MS` (30 s) instead of inheriting
a default that belongs to neither the case nor the runner, with the measurement
above recorded where a reader will find it.

**What would diagnose it further**: the failing case's own duration. The job's
log carries the file's total and the timeout's line, but not how long the case
actually ran, so the next occurrence should be read with `--reporter=verbose`.
