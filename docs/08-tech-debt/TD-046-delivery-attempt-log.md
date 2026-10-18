---
id: TD-046
type: tech-debt
title: The attempt log a delivery does not keep
status: open
severity: medium
owner: notifications
related_epics:
  - EPIC-17
related_stories:
  - NOTIF-004
related_decisions:
  - DEC-060
created: 2026-10-17
updated: 2026-10-17
---

# TD-046 — the attempt log a delivery does not keep

Raised while implementing [[NOTIF-004]], whose Acceptance Criteria first
promised _"the attempt history is readable for one delivery, ordered, and
bounded."_

## What exists, and what does not

`notification_delivery` carries a **summary**: `attempt_count`,
`last_attempt_at`, `last_error_code`, `last_error_message` and
`provider_reference`. There is no child table, no audit row per try, and no
other record of an individual attempt — verified by searching the schema, the
migration and the worker's delivery path, not assumed.

So the surface shows **how many** attempts happened, **when** the last one ran
and **what it said**. An operator diagnosing a delivery that fails three times
sees the third failure and cannot see the first two, or whether the reasons
differed.

## Why it was not built here

The aggregate that [[NOTIF-001]] already implemented and reviewed chose a
summary, and the choice is coherent: retrying is **BullMQ's own retry**, not a
domain transition — the delivery is one unit of work. An attempt table would be
a **second home for the same truth** (the count and the last outcome would exist
twice, and the two could disagree), which is the shape `ENGINEERING-RULES.md`
asks an agent to avoid.

And the obvious candidate content is the problem. What an operator wants is the
**provider's raw error**. That is RESTRICTED material this epic has deliberately
kept out of every stored field, every DTO and every log line, so storing it
opens:

- a **data-classification decision** (is the column RESTRICTED, CONFIDENTIAL, or
  sanitized-then-INTERNAL?);
- **retention rules**, because `DATA-CLASSIFICATION-RETENTION.md` forbids
  automatic destructive retention for audit-adjacent records without an approved
  policy — and an attempt log is exactly that;
- a sanitization step anyway, since a provider's error can echo the destination
  or the body — at which point the "raw" diagnostic is not raw.

## The options, with their real costs

| Option                                                                                          | Cost                                                                        | What it buys                                            | What it does not                                              |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Amend the Story's AC to the summary and keep this record                                        | ~0                                                                          | The epic closes with an honest boundary                 | The sequence of attempts                                      |
| Add `notification_delivery_attempt` storing instant, outcome and the **already-bounded** reason | A table, a migration, a write on the worker's failure path, a reader, tests | A true sequence, and the count stops being load-bearing | The raw provider error                                        |
| Add it storing the **raw** provider error                                                       | The above, plus a classification decision, retention rules and sanitization | Maximum diagnosis                                       | — it still needs sanitizing, so it converges on the row above |

## What a future unit must decide

1. Whether the attempt log is worth a second home for the count, or whether
   `last_error_message` plus a richer failure code is enough.
2. If it is: which content, given the classification and retention consequences
   above.
3. Where the write goes — the worker's failure and success paths both, or only
   the failure path. Only failures would leave a delivery with attempts and no
   rows, which is a worse diagnostic than today's summary.

## Related

- `docs/02-stories/NOTIF-004-transactional-surface-and-permissions.md` — the
  amended AC.
- `packages/database/prisma/schema.prisma` — `NotificationDelivery`.
