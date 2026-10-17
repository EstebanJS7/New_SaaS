---
id: TD-042
type: tech-debt
title:
  The advisories the advisory FIX produced, two of them defects in the fix
  itself
status: resolved
severity: low
owner: notifications
related_epics:
  - EPIC-17
related_stories:
  - NOTIF-002
related_decisions:
  - DEC-058
created: 2026-10-17
updated: 2026-10-17
---

# TD-042 — the advisories the advisory fix produced

Raised by `review-15bb8c29f08b5a2f` (the [[TD-040]] + [[TD-041]] fix unit):
**approved on the first pass with no blocking finding** and four non-blocking
advisories. The closure published descriptive ids this time, which is what let
each one be identified without a reading, and **two of the four are defects the
fix itself introduced or failed to close**.

## R3-1 — an async teardown was not awaited (`email.channel.ts`) — FIXED

**A defect in the fix, and its own comment was the lie.** [[TD-040]] R3-002
added a `try { transport.close?.(); } catch {}` around the teardown and the
comment claimed "a rejected `close()` promise would become an unhandled
rejection" was handled. It was not: a `try/catch` catches a synchronous throw
and nothing about a returned promise, so an async `close()` that rejected
produced exactly the unhandled rejection the comment said it prevented.

Fixed by declaring `close?(): void | Promise<void>` and **awaiting** it inside
the guard. Case: a transport whose `close()` returns a rejected promise still
resolves `SENT`, with a `process.on("unhandledRejection")` listener asserting
nothing escaped.

## R3-2 — `Number` is lenient in two more ways (`channel.module.ts`) — FIXED

[[TD-040]] R3-003 replaced `parseInt` with `Number` and stopped there.
`Number("1e3")` is `1000` and `Number("0x10")` is `16`, so a deployment input in
scientific notation or hex was still accepted as a port.

Fixed by validating the STRING first (`/^[0-9]{1,5}$/`) and converting after.
Cases: `1e3`, `0x10` and `587.5` join the refused list.

## R3-3 — an absolute URL is not a usable one (`whatsapp.channel.ts`) — FIXED

[[TD-040]] R3-001 validated the base URL with `new URL(...)`, which accepts ANY
scheme: `new URL("file:///etc/passwd")` parses happily. A scheme `fetch` cannot
use would then be classified as an unreachable provider and retried to the end
of the budget — the same misattribution the original fix was meant to remove.

Fixed by requiring `https:` or `http:`. Cases: `file:`, `ftp:` and `javascript:`
refused; `http:` accepted.

## R3-4 — a settle ran inside the gates' `try` (`handler.ts`) — FIXED

**A defect in the fix.** [[TD-041]] R3-001 wrapped the gate phase in a `try`,
and `settleFailure` was called from INSIDE it. A settle write that failed was
therefore caught and reinterpreted as a retryable failure: a delivery that had
faithfully failed non-retryably — an unresolved recipient, a tenant without the
grant — would be **retried, and its message attempted again**, because the write
that records the settle failed.

Fixed by splitting the phase into `decide` (inside the `try`, returning a
DECISION rather than acting) and `deliver` (outside it, settling or sending).
Case: a settle write that rejects propagates as itself, with no third write
issued and no "will be retried" rewriting.

## The review of this fix, and its one CRITICAL

`review-6352b1dea9a6addf` reviewed this unit as its own candidate and closed
with **one CRITICAL** — `R3-decide-retryable-branch`, `introduced` — plus one
advisory.

**The CRITICAL's behavioural premise was wrong, and that was settled by
measurement rather than by argument.** It claimed that `decide`'s catch branch
returns the value of `recordRetryableFailure`, so `decide` could resolve with
something that is not a decision and `deliver`'s `"failure" in decision` would
throw a `TypeError`; or, on its alternative reading, that `deliver` would settle
a delivery twice. What the code does is declared and observable:
`recordRetryableFailure` is typed `Promise<never>` and always throws, so the
`return` never resolves, neither failure mode can occur, and the case named
_"records a trace when a gate throws, then retries"_ passes precisely because it
asserts that rejection.

**What was true is the shape**, and it cost two reviewers their reading: a
`return` of a never-returning action, from a function declared to return a union
of decisions, reads as though a value flowed back. So the correction (`fe92bec`,
22 diff lines) awaited the call as a statement with an explicit unreachable
throw, and pinned the doubted behaviour with an assertion that the path issues
exactly two writes — the claim and the retryable reason — and that neither sets
`FAILED`. An independent targeted validator confirmed both criteria and stated
the same thing about the original shape. The finding is therefore recorded as
**a reviewability defect that was real about the code's readability and false
about its behaviour**, which is the useful version of "the reviewer was wrong".

**`R3-gate-throw-unproved` (advisory, coordinate not captured).** A reading: the
explicit unreachable `throw` cannot be exercised by any case, so it is dead code
whose claim of unprovability is itself unproven. The alternative is to delete it
and let the awaited call stand alone — which is what the original shape did, and
what made two reviewers misread it. Keeping a line whose only job is to be
obvious is a reasonable trade; it is recorded here rather than argued.

## The lesson worth keeping

A fix reviewed against the finding it closes can still be wrong, and two of
these were. Both were caught only because the review re-read the amended code
rather than the diff's intent — and both were **documentation-vs-behaviour**
failures (a comment asserting a guarantee the code did not provide; a fix that
closed one leniency and left two). That is the argument for reviewing the fix as
its own candidate instead of treating a closed advisory as done.

## Related

- [[TD-040]] and [[TD-041]] — the advisories this unit fixed, and whose fixes
  R3-1 and R3-4 are about.
- `docs/02-stories/NOTIF-002-channel-port.md` — the Story both books belong to.
