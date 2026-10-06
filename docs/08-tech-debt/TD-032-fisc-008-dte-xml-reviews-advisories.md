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
updated: 2026-10-06
---

# TD-032 — FISC-008 DTE XML review advisories

## Context

FISC-008 is being delivered as three work units: **WU-A** the builder, **WU-B**
the schema-validation gate, and **WU-C** the invoice → request mapping, which is
blocked on [[DEC-054]]. WU-A, WU-B and the two corrections that followed each
closed their own native review with `approved`.

WU-B's candidate needed **one bounded correction** before it closed: the review
returned a single `CRITICAL`, `R2-control-flow`, which was corrected in
`580de4a` and validated. That correction is not debt; it is recorded in the
Story. Every finding below is a **non-blocking** one — none opened a correction,
none reopens its review, and no correction transition is offered for its
candidate.

The provider reports each finding's identifier, lens, location, severity and
disposition. It does not return the finding's prose, and a burned lineage's
detail is no longer retrievable, so the descriptions below say what the flagged
lines _are_; the reviewer's own artifact was the authoritative wording.

## The advisories

Rows are marked **RESOLVED** where the code changed; they are kept in place
rather than removed, so a reader comparing the table against the code sees the
item and its disposition together.

| Id                             | Lens        | Severity   | Location                                                | What is at that location                                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------- | ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R1-001`                       | risk        | SUGGESTION | `pnpm-workspace.yaml:18`                                | `libxmljs2: true` — the allowed install script for the new native devDependency. Accepted as-is.                                                                                                                                                                                                        |
| `R2-evidence-count`            | readability | WARNING    | `docs/10-qa/CI-EVIDENCE.md:1480`                        | A case count in the CI record. **The count was wrong and is corrected**: WU-B adds 16, not 30; the 22 builder cases are WU-A's.                                                                                                                                                                         |
| `R2-failure-code`              | readability | SUGGESTION | `packages/fiscal/src/dte/xsd-validator.ts:65`           | `ARTIFACT_MISSING` was thrown for any unusable directory, so a too-small or unrewritten one reported itself as missing. **RESOLVED**: a dedicated `DIRECTORY_UNUSABLE` code.                                                                                                                            |
| `R3-001`                       | reliability | WARNING    | `packages/fiscal/src/dte/xsd-artifacts.ts:309-310`      | The include rewrite followed by `assertNoAbsoluteSchemaLocations` on the entry artifact. **RESOLVED**: the assertion now runs over all seven artifacts.                                                                                                                                                 |
| `R3-002`                       | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-validator.ts:63-69`        | The same unusable-directory guard as `R2-failure-code`. **RESOLVED** with it, and the message now names the unrewritten files instead of printing a boolean.                                                                                                                                            |
| `R3-003`                       | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.test.ts:152-177` | The two "unprepared directory" cases. Superseded by the tightened retry case and the nested-include case below.                                                                                                                                                                                         |
| `R4-fetch-no-retry-timeout`    | resilience  | WARNING    | `packages/fiscal/src/dte/xsd-artifacts.ts:166-168`      | `defaultFetch` called `fetch(url)` with no timeout and no retry. **RESOLVED**: `AbortSignal.timeout(20s)` per attempt plus one bounded retry.                                                                                                                                                           |
| `R3-D208C-OPTIN`               | reliability | SUGGESTION | `packages/fiscal/src/dte/dte.rules.ts:457-460`          | `D208c` is evaluated only when the caller supplies a total, so a request omitting both escapes the rule. **Not a defect**: it is a constraint on the WU-C mapper, which must always supply one.                                                                                                         |
| `R3-001` (fetch)               | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.ts:196-200`      | The 5xx retry `continue`d without reading or cancelling the response body. **RESOLVED**: the body is drained before retrying.                                                                                                                                                                           |
| `R3-002` (fetch)               | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.ts:199-200`      | The `catch` set `lastError` and broke on the final attempt; the post-loop message depended on that assignment. **RESOLVED**: the message no longer depends on it, and the attempt count is floored at one.                                                                                              |
| `R3-003` (fetch)               | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.test.ts:172`     | The retry case asserted `calls > 7`, which proves a retry happened but not which artifact was retried or that it was exactly one. **RESOLVED**: exactly 8 calls, the retried URL is the first artifact's, the other seven distinct.                                                                     |
| `R4-hermetic-guard-entry-only` | resilience  | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.ts:338-343`      | The unrewritten-includes guard inspected only the entry artifact. **RESOLVED**: preparation and inspection both check **all seven**, `unrewrittenIncludes` names the files instead of a boolean, and a case injects a nested absolute include into a companion schema to prove preparation fails on it. |
| `R3-001` (TD-032 review)       | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.ts:237`          | `FETCH_FAILED`'s message assembles the attempt count, the 5xx note and the cause in one template literal. Cosmetic: it is the message, not the logic. **Open.**                                                                                                                                         |
| `R3-002` (TD-032 review)       | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.test.ts:302`     | The "entry schema was never rewritten" case asserts the file name but does not also assert that the walk reported the other six as fine. **Open.**                                                                                                                                                      |

**The last two rows arrived from TD-032's own resolution review**, and they are
why this file is `open` rather than `resolved`: the resolutions landed, and
their own review returned two `SUGGESTION`s that are new work — neither reopens
a closed item nor blocks anything. Both are cosmetic.

## What was acted on, and in which order

**Everything actionable here is resolved.** The order is kept because it records
why it was chosen.

1. **`R4-fetch-no-retry-timeout`** — a hung connection held the CI job until the
   runner's own limit, a failure with no useful message. Fixed first because it
   was the only one with a plausible failure mode rather than a message or an
   observation to improve.
2. **`R4-hermetic-guard-entry-only`** — the most substantive of the rest,
   because it closed a real hole in the **hermeticity claim**: only
   `DE_v150.xsd` is rewritten, so a nested absolute include inside a companion
   schema survived and would have reached the network at validation time. The
   guard now covers every artifact, in preparation and in inspection.
3. **`R2-failure-code` / `R3-002`** — a dedicated code, so a too-small or
   unrewritten directory no longer reports itself as a missing one.
4. **`R3-001`/`R3-002`/`R3-003` (fetch)** — the discarded 5xx body is drained,
   the error message no longer depends on an assignment having happened, and the
   retry case asserts the count, the identity and the distinctness instead of
   `calls > 7`.
5. **`R3-D208C-OPTIN`** — deliberately **not** "fixed". Making it mandatory
   would mean inventing a total when the caller supplies none, and the honest
   place for that obligation is the mapper: **WU-C must always supply a `D208c`
   total**.
6. **`R2-evidence-count`** — corrected when it was found, because a wrong number
   in the evidence file is not a later-work item.

## Not debt

- The `CRITICAL` `R2-control-flow` was corrected and validated; see the Story's
  review record. Its premise did not reproduce (the `continue` was present), but
  the correction still lands because the flagged construct is what got misread.
- The **D208c correction** itself is not debt — it is a rule implemented once
  §22.12 transcribed it.
- `R3-D208C-OPTIN` is not debt either: it is a requirement the WU-C mapper
  inherits, and it is recorded in the tracker with that work unit.
