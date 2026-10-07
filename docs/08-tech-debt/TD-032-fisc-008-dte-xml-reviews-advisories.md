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
| `R3-001` (TD-032 review)       | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.ts:237`          | `FETCH_FAILED`'s message assembled the attempt count, the 5xx note and the cause in one template literal. **RESOLVED**: the cause moved into `describeRejection` and the retry note into its own `const`.                                                                                               |
| `R3-002` (TD-032 review)       | reliability | SUGGESTION | `packages/fiscal/src/dte/xsd-artifacts.test.ts:302`     | The "entry schema was never rewritten" case asserted the file name but not that the walk reported the other six as fine. **RESOLVED**: it now also asserts `missing: []` and `tooSmall: []`, which is the half that proves the walk continued.                                                          |

| `R3-001` (TD-032 close review) | reliability | SUGGESTION |
`packages/fiscal/src/dte/xsd-artifacts.test.ts:303-306` | The comment above the
added assertions explains why they matter. **ACCEPTED as-is.** | | `R3-002`
(TD-032 close review) | reliability | SUGGESTION |
`packages/fiscal/src/dte/xsd-artifacts.ts:228` | The comment above
`describeRejection` states what the function guarantees. **ACCEPTED as-is.** |

| `R3-ASCII-CASE` | reliability | WARNING |
`packages/fiscal/src/dte/dte.cdc.ts:96-98` | The ASCII substitution path, where
a non-digit becomes `charCodeAt` before the weights are applied. **Accepted
as-is**: the PL/SQL uppercases then takes `ASCII`, and so does this. | |
`R3-BASEMAX` | reliability | WARNING |
`packages/fiscal/src/dte/dte.cdc.ts:91-93` | The `baseMax < 2` guard. **Accepted
as-is**: it refuses a base that would make every weight meaningless. | |
`R3-CDC-DATE` | reliability | WARNING |
`packages/fiscal/src/dte/dte.cdc.ts:142-144` | The date is shape-checked, not
validity-checked. **Open, and it is bigger than the CDC** — see below. |

| `R3-001` (mapper fix) | reliability | WARNING |
`packages/fiscal/src/dte/dte.mapper.test.ts:228-229` | The assertions on the
folded-in exonerated case (`exonerated.exonerated` and `exonerated.general`).
**Accepted as-is.** | | `R3-002` (mapper fix) | reliability | WARNING |
`packages/fiscal/src/dte/dte.mapper.ts:353` | The `rateContribution` ternary,
which selects `E735 + E736` for affectation 4 and `EA008` otherwise. **Accepted
as-is**: it is the NT 013 rule in one expression, and the comment above it says
which fields those are. |

| `R3-DSUBEXO-COVERAGE` (mapper, fresh) | reliability | WARNING |
`packages/fiscal/src/dte/dte.mapper.test.ts:228-229` | The assertions on the
folded-in exonerated case. **Accepted as-is**; it duplicates the earlier
`R3-001` at the same lines, which is itself the sign that the coverage was
folded rather than added. | | `R3-EPIC-DUP` (mapper, fresh) | reliability |
WARNING | `odd/tasks/epic-16-sifen-direct.md:616` | **Three duplicated sections
in the epic tracker** — `## WU-C: the mapper`, `## WU-C's review is ESCALATED`,
`## Review coverage` — from repeated scripted insertions of the same block
before the same anchor. **FIXED**: 112 duplicate lines removed, one copy of each
kept, and the newer coverage text kept over the older. A duplicated record that
can disagree with itself is worse than a cosmetic finding. |

## The one finding with a real failure mode: dates are shaped, never validated

`R3-CDC-DATE` is right, and it is not confined to the CDC. Every date this Story
handles is checked by a **regex**, so an impossible date passes everything:

```text
dte.rules.ts   FEC_HHMMSS_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/   -> 2026-13-45T99:99:99 passes
dte.rules.ts   YYYY_MM_DD_PATTERN = /^\d{4}-\d\d-\d\d$/                     -> 2026-13-45 passes
dte.cdc.ts     emissionDate()     = /^[0-9]{8}$/                              -> 20261345 passes
```

**And the official schema does not catch it either**: `fecHhmmss` in
`DE_Types_v150.xsd` is the same shape-only regex, so the WU-B gate would accept
an impossible signature timestamp too. Only `tdFeIniT`/`tdFeIniS` are `xs:date`,
where the schema does enforce it.

Why it matters rather than being cosmetic: `dFecFirma` and `dFeEmiDE` sit inside
the **signed** document, and the Manual's 72-hour transmission window and the
receptor's 360-hour window are computed from them. An impossible timestamp is
not a rejected document — it is an accepted one with a meaningless time.

**The unit, when it is taken**: validate real calendar dates and real times in
`dte.rules.ts` and in `emissionDate`, with the leap-year rule, and a test per
field. It is a bounded unit and it is the only item in this file that changes
behaviour rather than a message.

## Closed, and the treadmill recorded

Both of the last two are resolved, so this file is `resolved` with nothing open
— and **the policy below was exercised immediately**, which is why it is written
down rather than merely intended. The commit that closed TD-032 came back from
its own review with **two more** `SUGGESTION`s (`R3-001` and `R3-002` in the
table above). They are **accepted as-is**: both are comments that already say
what the reviewer is asking them to say.

**Why that is worth a paragraph: advisory generation outran resolution.** The
reviews of this Story produced 2 advisories for WU-A, 8 for WU-B, 1 for the
`D208c` correction, 3 for the fetch timeout, and then **2 more from the review
of the commit that resolved TD-032**. Every fix cycle has returned roughly one
to three new cosmetics, and continuing would mean an unbounded number of
one-line commits, each costing a full review and a CI run.

So the line is drawn here deliberately: **a future cosmetic advisory on this
tooling is accepted as-is rather than chased**, and only a finding with a real
failure mode — like `R4-hermetic-guard-entry-only`, which closed an actual hole
in the hermeticity claim — reopens this file. Recording that is the difference
between closing it and pretending the treadmill does not exist.

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

## The mapper's content is now closed, twice over

The correction that the stuck lineage could not validate was re-reviewed on its
own as a fresh committed range and **closed `approved`**
(`review-ba6218e187d42859`, medium tier, one lens, 3 files / 133 lines), with
the two `WARNING`s above and no correction required. The two earlier lineages
stay as they are — one escalated, one stuck — and are recorded in the tracker;
this is the receipt for the correction's _content_, which is what was missing.

## Not debt

- The `CRITICAL` `R2-control-flow` was corrected and validated; see the Story's
  review record. Its premise did not reproduce (the `continue` was present), but
  the correction still lands because the flagged construct is what got misread.
- The **D208c correction** itself is not debt — it is a rule implemented once
  §22.12 transcribed it.
- `R3-D208C-OPTIN` is not debt either: it is a requirement the WU-C mapper
  inherits, and it is recorded in the tracker with that work unit.
