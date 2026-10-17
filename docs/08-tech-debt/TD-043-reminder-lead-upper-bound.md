---
id: TD-043
type: tech-debt
title:
  The reminder policy validates its lead time's floor and ignores the ceiling
  its own module exports
status: open
severity: low
owner: notifications
related_epics:
  - EPIC-17
related_stories:
  - NOTIF-003
related_decisions:
  - DEC-060
created: 2026-10-17
updated: 2026-10-17
---

# TD-043 — the lead time's missing ceiling

Raised by `review-1e2d96c3a65e27b4` (EPIC-17 WU-D1): **approved on the first
pass** with one SUGGESTION, `R3-reminder-lead-upper-bound`, at
`packages/notifications/src/reminder.policy.ts:86`.

**The coordinate speaks for itself, and this time the claim needed no reading.**

```ts
export function reminderScheduledAt(startsAt: Date, leadHours: number): Date {
  if (
    !Number.isInteger(leadHours) ||
    leadHours < NOTIFICATION_REMINDER_LEAD_HOURS_MIN
  ) {
    throw new Error(
      `A reminder lead time must be a whole number of hours of at least …`
    );
  }
  return new Date(startsAt.getTime() - leadHours * 60 * 60 * 1_000);
}
```

The module **exports `NOTIFICATION_REMINDER_LEAD_HOURS_MAX`** and the settings
schema enforces it, but the function that performs the arithmetic checks only
the floor and integrality. A caller that passed `10_000` hours would get a date
roughly fourteen months early and no complaint — from a function whose own
module declares that a longer lead "makes '24 h before' a different feature".

**Why it is not a live defect yet.** The only consumer today is the settings
namespace, whose zod schema refuses anything above 168, so no reachable path
supplies a value the function would mishandle. That is exactly why this is a
suggestion and not a blocker: the guard is missing from the boundary that
_should_ be self-contained, not from a boundary that is currently wrong.

**The fix is two lines**: compare against `NOTIFICATION_REMINDER_LEAD_HOURS_MAX`
in the same condition and name the ceiling in the message, with a case that
fails without it (`169` accepted today, refused after).

**Where it lands.** [[NOTIF-003]] WU-D2 consumes this policy from the scheduler,
so the fix belongs in that unit rather than in a unit of its own — the same way
EPIC-16 folded two of TD-033's items into later work inside the same epic.

## Related

- `docs/02-stories/NOTIF-003-appointment-reminder-and-emitters.md` — the Story.
- [[DEC-060]] — the policy whose bounds this function partly enforces.
