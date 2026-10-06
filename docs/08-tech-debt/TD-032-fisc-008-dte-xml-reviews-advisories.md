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

| Id                          | Lens        | Severity   | Location                                                | What is at that location                                                                                                                         |
| --------------------------- | ----------- | ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `R1-001`                    | risk        | SUGGESTION | `pnpm-workspace.yaml:18`                                | `libxmljs2: true` — the allowed install script for the new native devDependency.                                                                 |
| `R2-evidence-count`         | readability | WARNING    | `docs/10-qa/CI-EVIDENCE.md:1480`                        | A case count in the CI record. **The count was wrong and is corrected**: WU-B adds 16, not 30; the 22 builder cases are WU-A's.                  |
| `R2-failure-code`           | readability | SUGGESTION | `packages/fiscal/src/dte/xsd-validator.ts:65`           | `ARTIFACT_MISSING` is thrown for any unusable directory, including one that is merely too small or unrewritten.                                  |
| `R3-001`                    | reliability | WARNING    | `packages/fiscal/src/dte/xsd-artifacts.ts:309-310`      | The include rewrite followed by `assertNoAbsoluteSchemaLocations` on the entry artifact.                                                         |
| `R3-002`                    | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-validator.ts:63-69`        | The same unusable-directory guard as `R2-failure-code`.                                                                                          |
| `R3-003`                    | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.test.ts:152-177` | The two "unprepared directory" cases.                                                                                                            |
| `R4-fetch-no-retry-timeout` | resilience  | WARNING    | `packages/fiscal/src/dte/xsd-artifacts.ts:166-168`      | `defaultFetch` calls `fetch(url)` with no timeout and no retry.                                                                                  |
| `R3-D208C-OPTIN`            | reliability | SUGGESTION | `packages/fiscal/src/dte/dte.rules.ts:457-460`          | `D208c` is evaluated only when the caller supplies a total, so a request omitting both escapes the rule. From the D208c correction's own review. |
| `R3-001` (fetch)            | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.ts:196-200`      | The 5xx retry `continue`s without reading or cancelling the response body.                                                                       |
| `R3-002` (fetch)            | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.ts:199-200`      | The `catch` sets `lastError` and breaks on the final attempt; the error message built after the loop depends on that assignment having happened. |
| `R3-003` (fetch)            | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.test.ts:172`     | The retry case asserts `calls > 7`, which proves a retry happened but not which artifact was retried or that it was exactly one.                 |

**The three `R3-*` fetch advisories came from the timeout work's own review**
and are all `SUGGESTION`: the retry loop works, and each one is about how
precisely it is observed or how cleanly it releases a discarded response. |
`R4-hermetic-guard-entry-only` | resilience | SUGGESTION |
`packages/fiscal/src/dte/xsd-artifacts.ts:338-343` | The unrewritten-includes
guard inspects only the entry artifact, not the other six. |

## What is worth acting on, in order

1. **`R4-fetch-no-retry-timeout` — RESOLVED 2026-10-05.** The fetch now arms a
   per-attempt `AbortSignal.timeout(20s)` and retries once on a transport
   failure or a 5xx. A 4xx is returned without a retry, because a 404 is an
   answer, and a 200-with-wrong-bytes is not retried either — retrying an
   assertion failure is how a wrong artifact gets papered over. Four cases cover
   it: a flaky transport then success, every attempt failing (`FETCH_FAILED`), a
   5xx retried while a 404 is not, and the timeout signal actually being armed
   on the real `fetch`. The live fetch was re-run against DNIT afterwards and
   prepared all seven artifacts with the same sizes.
2. **`R2-failure-code` / `R3-002`** — a dedicated failure code for "the
   directory is unusable" would stop a too-small or unrewritten directory from
   reporting itself as a missing one. Cheap, and it improves the message the
   gate prints when it fails.
3. **`R4-hermetic-guard-entry-only`** — extending the guard to all seven
   artifacts would also catch straight after preparation instead of at
   validation time.
4. **`R3-D208C-OPTIN`** — `D208c` is opt-in on the total being supplied, which
   is the honest consequence of the request carrying the totals instead of
   computing them: **the mapper WU-C builds must always supply one**. Recorded
   so the mapper does not forget, rather than "fixed" by inventing a total.
5. The rest are polish. `R2-evidence-count` was a factual error in the review
   record and is already corrected, because a wrong number in the evidence file
   is not a later-work item.

## Not debt

- The `CRITICAL` `R2-control-flow` was corrected and validated; see the Story's
  review record. Its premise did not reproduce (the `continue` was present), but
  the correction still lands because the flagged construct is what got misread.
- `R4-fetch-no-retry-timeout` is resolved, so it is kept in the table as history
  rather than moved out of it: a reader comparing the table against the code
  should see the item and its disposition together.
- The **D208c correction** itself is not debt — it is a rule implemented once
  §22.12 transcribed it — and its own review returned the single advisory
  `R3-D208C-OPTIN` above.
