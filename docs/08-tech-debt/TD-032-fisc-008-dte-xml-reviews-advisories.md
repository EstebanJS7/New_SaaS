---
id: TD-032
type: tech-debt
title: FISC-008 DTE XML review advisories
status: open
severity: medium
related_epics:
  - EPIC-16
related_stories:
  - FISC-008
created: 2026-10-05
updated: 2026-10-05
---

# TD-032 — FISC-008 DTE XML review advisories

## Context

FISC-008 is being delivered as three work units: **WU-A** the builder, **WU-B**
the schema-validation gate, and **WU-C** the invoice → request mapping, which is
blocked. WU-A and WU-B each closed their own native review with `approved`, so
the receipt stands for both.

WU-B's candidate needed **one bounded correction** before it closed: the review
returned a single `CRITICAL`, `R2-control-flow`, which was corrected in
`580de4a` and validated. That correction is not debt; it is recorded in the
Story. The eight findings below are the **non-blocking** ones that came out of
the same run: none opened a correction, none reopens the review, and no
correction transition is offered for the candidate. They are recorded here as
separate later work — and never as a reason to re-run the review.

The provider reports each finding's identifier, lens, location, severity and
disposition. It does not return the finding's prose, and a burned lineage's
detail is no longer retrievable, so the descriptions below say what the flagged
lines _are_; the reviewer's own artifact was the authoritative wording.

## The advisories

| Id                             | Lens        | Severity   | Location                                                | What is at that location                                                                                                        |
| ------------------------------ | ----------- | ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `R1-001`                       | risk        | SUGGESTION | `pnpm-workspace.yaml:18`                                | `libxmljs2: true` — the allowed install script for the new native devDependency.                                                |
| `R2-evidence-count`            | readability | WARNING    | `docs/10-qa/CI-EVIDENCE.md:1480`                        | A case count in the CI record. **The count was wrong and is corrected**: WU-B adds 16, not 30; the 22 builder cases are WU-A's. |
| `R2-failure-code`              | readability | SUGGESTION | `packages/fiscal/src/dte/xsd-validator.ts:65`           | `ARTIFACT_MISSING` is thrown for any unusable directory, including one that is merely too small or unrewritten.                 |
| `R3-001`                       | reliability | WARNING    | `packages/fiscal/src/dte/xsd-artifacts.ts:309-310`      | The include rewrite followed by `assertNoAbsoluteSchemaLocations` on the entry artifact.                                        |
| `R3-002`                       | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-validator.ts:63-69`        | The same unusable-directory guard as `R2-failure-code`.                                                                         |
| `R3-003`                       | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.test.ts:152-177` | The two "unprepared directory" cases.                                                                                           |
| `R4-fetch-no-retry-timeout`    | resilience  | WARNING    | `packages/fiscal/src/dte/xsd-artifacts.ts:166-168`      | `defaultFetch` calls `fetch(url)` with no timeout and no retry.                                                                 |
| `R4-hermetic-guard-entry-only` | resilience  | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.ts:338-343`      | The unrewritten-includes guard inspects only the entry artifact, not the other six.                                             |

## What is worth acting on, in order

1. **`R4-fetch-no-retry-timeout`** — the fetch has no timeout, so a hung
   connection holds the CI job until the runner's own limit. A per-request
   timeout plus one bounded retry is a small, contained fix, and it is the only
   advisory here with a plausible failure mode rather than a polish one.
2. **`R2-failure-code` / `R3-002`** — a dedicated failure code for "the
   directory is unusable" would stop a too-small or unrewritten directory from
   reporting itself as a missing one. Cheap, and it improves the message the
   gate prints when it fails.
3. **`R4-hermetic-guard-entry-only`** — extending the guard to all seven
   artifacts would also catch straight after preparation instead of at
   validation time.
4. The rest are polish. `R2-evidence-count` was a factual error in the review
   record and is already corrected, because a wrong number in the evidence file
   is not a later-work item.

## Not debt

- The `CRITICAL` `R2-control-flow` was corrected and validated; see the Story's
  review record. Its premise did not reproduce (the `continue` was present), but
  the correction still lands because the flagged construct is what got misread.
