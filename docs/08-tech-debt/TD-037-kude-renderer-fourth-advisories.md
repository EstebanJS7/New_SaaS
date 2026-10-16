---
id: TD-037
type: tech-debt
title:
  The KuDE renderer's fourth advisory round — the caught refusal, and the two
  tests around it
status: open
severity: low
owner: fiscal
created: 2026-10-15
updated: 2026-10-15
related:
  - FISC-013
  - TD-036
---

# TD-037 — the KuDE renderer's fourth advisory round

Two findings from the review that approved TD-036's fix were accepted as debt
rather than fixed, for the reason the previous three rounds record: their
disposition is informational, neither opened a correction, and editing the
candidate after its authority was burned would have invalidated the approval
without producing a new one.

**The review's full text is not retained**, so this carries the coordinates the
closure published and a reading of each, marked as a reading. Anyone acting on
one should re-derive the claim from the code first.

## 1. The adapter catches the shared helper's refusal

`packages/fiscal/src/kude/kude.builder.ts:201` — the `if` in `addKudeDecimals`:

```ts
} catch (error) {
  if (error instanceof DteValidationError && error.failure === "INVALID_MONEY_SCALE") {
    return undefined;
  }
  throw error;
}
```

**The reading**: the guard is narrow — by error type **and** by code, with
everything else rethrown — so what a reader should check is whether
`INVALID_MONEY_SCALE` is the only refusal `addDecimals` can raise for an
unreadable value, and whether any _other_ cause shares that code. `scale()` in
the same module raises the same code for a value whose fraction exceeds its
type's scale, which is a different failure with the same name: if the renderer
ever reached that path, a scale problem would be reported as an unreadable
subtotal. Today it does not — `addDecimals` only normalises — but the coupling
is by a shared string, and a test that pinned "this code means unreadable, that
one means mis-scaled" would be what keeps it true.

## 2. The two tests that came with the fix

`packages/fiscal/src/kude/kude.builder.test.ts:362-382` — the negative-subtotal
case and the scale case.

**The reading**: the first asserts the absence names `dSubExe`, which is the
right shape, but it does not assert what a **reader** of that absence needs —
that the other two fields are _not_ indicted — even though the test one describe
above it does exactly that for the two-field case. The second pins the shared
helper's headline behaviour at scale, and it would be stronger as a pair: the
same sum asserted against `addDecimals` directly, so the day the renderer grows
its own arithmetic again, the test says so instead of agreeing with itself.
