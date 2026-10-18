---
id: TD-039
type: tech-debt
title:
  The fiscal submission producer's job id carries a colon, which BullMQ refuses,
  so no fiscal document can be enqueued in production
status: resolved
severity: high
owner: fiscal
related_epics:
  - EPIC-16
  - EPIC-15
related_stories:
  - FISC-004
created: 2026-10-17
updated: 2026-10-17
---

# TD-039 — the fiscal job id BullMQ refuses

## What is wrong

`packages/fiscal/src/fiscal-submission.queue.ts` builds the queue identity as:

```ts
export function fiscalSubmissionJobId(fiscalDocumentId: string): string {
  return `fiscal-submit:${fiscalDocumentId}`;
}
```

and `fiscalSubmissionJobOptions` passes it to `queue.add` as `jobId`. **BullMQ
rejects a custom job id containing `:`** unless it splits into exactly three
segments (the compatibility carve-out for its own repeatable-job format), so
`BullMqFiscalSubmissionProducer.enqueue` throws before anything is enqueued.

## How it was found, and why CI is green

Found by the EPIC-17 WU-B review (`review-2ab7f3074e541ccd`, lens
`review-reliability`) as **R3-001**, a CRITICAL against the _notification_
boundary's own job id, which had copied this shape. The notification boundary
was fixed in that unit and the correction was validated. This item is the same
defect on the fiscal side, which is out of that unit's scope.

**It was measured, not inferred.** Against `bullmq@5.81.3` (the version this
repository resolves) with a real Redis:

```text
id="notification-deliver:abc" -> Error: Custom Id cannot contain :
id="fiscal-submit:abc"        -> Error: Custom Id cannot contain :
id="a:b:c"                    -> ADDED        (three segments: the carve-out)
id="notification-deliver-abc" -> ADDED
id="42"                       -> Error: Custom Id cannot be integers
```

The source of the rule is `bullmq/dist/cjs/classes/job.js`, whose own comment
says: _"TODO: replace this check in next breaking check with include(':'). By
using split we are still keeping compatibility with old repeatable jobs."_

**Why every gate passes anyway:**

- `apps/api/src/fiscal/fiscal-submission.producer.test.ts` asserts the literal
  `jobId: "fiscal-submit:document-1"` against a **mocked** `Queue`
  (`{ add: vi.fn(), close }`), so nothing validates it. The test currently
  **enshrines** the defect.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` overrides
  `FISCAL_SUBMISSION_PRODUCER` with a fake, so the live suite never calls
  `queue.add` either.
- `branding-reset-cleanup` is **not** affected: it uses `jobId: intentId`, a
  bare UUID with no colon.

## Impact

Every fiscal enqueue fails at the producer. `POST`-path issue commands await the
enqueue behind a two-second deadline, so a tenant's invoice
confirmation-to-issue flow fails with an internal error rather than a fiscal
document. Nothing in the test suite can observe it, and `main`'s CI is green.

## Recommended fix

Change the separator to a hyphen — `fiscal-submit-${fiscalDocumentId}` — exactly
as the notification boundary now does, and update the three places that assert
the old literal. Then add the assertion that the id carries no colon, since a
mocked `Queue` cannot catch the rule and the literal alone is what locked it in.

The determinism contract [[DEC-049]] relies on is unaffected: the identity is
still derived from `fiscalDocumentId` alone, so the queue dedupe and the
document's partial unique index still agree on what "the same logical request"
means.

## Test that would have caught it

An id-shape assertion (`expect(fiscalSubmissionJobId(id)).not.toContain(":")`)
and, ideally, one live `queue.add` against a Redis in CI, since the rule lives
in BullMQ's `Job` constructor and only a real `Queue` reaches it.

## Resolution (2026-10-17)

Fixed on branch `fix/td-039-fiscal-job-id-colon` (commit `8561af0`, stacked on
the EPIC-17 branch because this record was created there), and **proven against
a real Redis rather than against a mock**:

```text
fiscalSubmissionJobId => fiscal-submit-9a1f4c2d-0b7e-4a11-9d3c-5f2b8e6a71c4
CONTROL (old, colon): Custom Id cannot contain :
FIXED (new, hyphen): ADDED as jobId=fiscal-submit-9a1f4c2d-0b7e-4a11-9d3c-5f2b8e6a71c4
```

The control is the separator that shipped, added through `queue.add` exactly as
the producer does; the fixed line is the real `fiscalSubmissionJobOptions`
passed to a real `Queue`.

What changed:

- `packages/fiscal/src/fiscal-submission.queue.ts` — the separator, plus the
  rule and this defect's history in the function's own doc comment, because the
  shape propagated once already: EPIC-17's notification boundary copied it.
- `packages/fiscal/src/fiscal-submission.queue.test.ts` — the literal, plus a
  shape assertion over several inputs (`not.toContain(":")`), which is the test
  that would have caught this. A mocked `Queue` cannot: the throw lives in
  BullMQ's `Job` constructor.
- `apps/api/src/fiscal/fiscal-submission.producer.test.ts` — the asserted
  literal and the mocked `add` result, with the reason recorded beside them.
- `docs/05-modules/Fiscal.md` and `docs/09-releases/CHANGELOG.md` — the
  implemented-behavior records, in the same change as the behaviour.

Verdict: the fix is one separator and it is verified end to end. The suite grew
by one case (fiscal 787 → 788). The determinism contract [[DEC-049]] relies on
is untouched: the identity is still derived from `fiscalDocumentId` alone.

**Review**: `review-757b99b67c3e5197` — medium tier, one lens
(`review-reliability`), consent relayed and granted by the maintainer,
**approved with no findings on the first pass**, acknowledged, authority burned.
No correction and no advisories, which is what a one-separator fix whose rule is
also asserted in a test should look like.

**Gates on the final tree**: `format-check` clean, lint 21/21, typecheck 21/21,
build 13/13, and the full suite green (fiscal 788, database 509, api 1214 passed
| 266 skipped without `DATABASE_URL_TEST`, worker 164, web 1087). No CI run yet:
the branch is local and unpushed.

## Related

- [[EPIC-17]] WU-B, which found it and fixed its own copy:
  `packages/notifications/src/notification-delivery.queue.ts`.
- [[DEC-049]] — the deterministic job identity this defect does not change.
- [[FISC-004]] — the unit that introduced the producer.
