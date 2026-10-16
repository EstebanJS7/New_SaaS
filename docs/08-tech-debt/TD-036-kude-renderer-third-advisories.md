---
id: TD-036
type: tech-debt
title:
  The KuDE renderer's third advisory round — the sign test asserts a formatted
  value, not the arithmetic
status: open
severity: low
owner: fiscal
created: 2026-10-15
updated: 2026-10-15
related:
  - FISC-013
  - TD-035
---

# TD-036 — the KuDE renderer's third advisory round

One finding from the review that approved TD-035's four fixes was accepted as
debt rather than fixed, for the reason the previous two rounds record: its
disposition is informational, it opened no correction, and editing the candidate
after its authority was burned would have invalidated the approval without
producing a new one.

**The review's full text is not retained**, so this carries the coordinate the
closure published and a reading of it, marked as a reading. Anyone acting on it
should re-derive the claim from the code first.

## 1. The sign test goes through the formatter, so it does not isolate the sum

`packages/fiscal/src/kude/kude.builder.test.ts:366-368` — the assertion in
"carries a sign through the sum instead of producing a non-number":

```ts
expect(
  built(requestWith({ subExe: "-100.0000", sub5: "50.0000" })).totals.subtotal
).toBe("-50");
```

**The reading**: this is the test TD-035's item 1 added, and it exercises
`addDecimalStrings` **through** `formatKudeAmount` and the builder, so what it
proves is that the pair produces `-50` — not that the sum itself keeps the sign.
The defect item 1 fixed lived in the sum's own string surgery (`padStart`
padding before a sign), and a regression there could still be masked by a
formatter that happens to re-add the sign: `formatKudeAmount` has its own
negative handling, so the two can cover for each other.

**The fix**: assert `addDecimalStrings` directly on the cases that matter — a
negative sum, a sum that lands on zero (not negative zero), and a negative input
at a different scale from its neighbour, which is where the `scale` computation
and the sign meet. The exported surface would need to include it, or the test
would need to reach it through a case the formatter cannot mask, such as a sum
whose formatted form is identical either way.
