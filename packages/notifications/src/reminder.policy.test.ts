import { describe, expect, it } from "vitest";
import {
  isReminderOverdue,
  NOTIFICATION_REMINDER_CHANNELS,
  NOTIFICATION_REMINDER_CHANNELS_DEFAULT,
  NOTIFICATION_REMINDER_LEAD_HOURS_DEFAULT,
  NOTIFICATION_REMINDER_LEAD_HOURS_MAX,
  NOTIFICATION_REMINDER_LEAD_HOURS_MIN,
  reminderDedupeKey,
  reminderScheduledAt,
  reminderWindowKey,
} from "./reminder.policy.js";

const startsAt = new Date("2026-10-18T12:00:00.000Z");

describe("the reminder policy's bounds and defaults", () => {
  it("defaults to 24 hours, a week at most and an hour at least", () => {
    // DEC-060's numbers, pinned so a settings schema and a scheduler cannot
    // disagree about what a lead time may be.
    expect(NOTIFICATION_REMINDER_LEAD_HOURS_DEFAULT).toBe(24);
    expect(NOTIFICATION_REMINDER_LEAD_HOURS_MIN).toBe(1);
    expect(NOTIFICATION_REMINDER_LEAD_HOURS_MAX).toBe(168);
  });

  it("defaults the channel set to the ungated channel alone", () => {
    // A default that included WhatsApp would silently require an entitlement the
    // tenant may not hold (DEC-058).
    expect(NOTIFICATION_REMINDER_CHANNELS_DEFAULT).toEqual(["EMAIL"]);
    expect(NOTIFICATION_REMINDER_CHANNELS).toEqual(["EMAIL", "WHATSAPP"]);
  });
});

describe("reminderScheduledAt", () => {
  it("subtracts the configured lead time from the appointment's start", () => {
    expect(reminderScheduledAt(startsAt, 24).toISOString()).toBe("2026-10-17T12:00:00.000Z");
    expect(reminderScheduledAt(startsAt, 1).toISOString()).toBe("2026-10-18T11:00:00.000Z");
    expect(reminderScheduledAt(startsAt, 168).toISOString()).toBe("2026-10-11T12:00:00.000Z");
  });

  it("refuses a lead time it cannot honour", () => {
    for (const lead of [0, -1, 1.5, Number.NaN]) {
      expect(() => reminderScheduledAt(startsAt, lead), String(lead)).toThrow(
        /whole number of hours/
      );
    }
  });

  it("reports an overdue reminder rather than refusing it", () => {
    // Shortening the lead time on an appointment that starts soon must produce a
    // reminder now, not an error.
    const scheduled = reminderScheduledAt(startsAt, 24);
    expect(isReminderOverdue(scheduled, new Date("2026-10-18T11:00:00.000Z"))).toBe(true);
    expect(isReminderOverdue(scheduled, new Date("2026-10-17T11:00:00.000Z"))).toBe(false);
    // Exactly due counts as due: the job is enqueued with no delay.
    expect(isReminderOverdue(scheduled, scheduled)).toBe(true);
  });
});

describe("the reminder's window and dedupe key", () => {
  it("derives the window from the start instant, truncated to the minute", () => {
    expect(reminderWindowKey(startsAt)).toBe("2026-10-18T12:00:00.000Z");
    // Seconds are noise: two reads of the same row must agree.
    expect(reminderWindowKey(new Date("2026-10-18T12:00:59.999Z"))).toBe(
      "2026-10-18T12:00:00.000Z"
    );
  });

  it("keys the intent by appointment, channel and window", () => {
    expect(reminderDedupeKey({ appointmentId: "a-1", channel: "EMAIL", startsAt })).toBe(
      "appointment:a-1:EMAIL:2026-10-18T12:00:00.000Z"
    );
  });

  it("is stable for one appointment start and DIFFERENT for a new one", () => {
    // The second half is the load-bearing one: a reschedule to another instant is
    // a legitimately new reminder, and a key that ignored the window would
    // silently suppress it (DEC-060).
    const first = reminderDedupeKey({ appointmentId: "a-1", channel: "EMAIL", startsAt });
    const again = reminderDedupeKey({ appointmentId: "a-1", channel: "EMAIL", startsAt });
    const moved = reminderDedupeKey({
      appointmentId: "a-1",
      channel: "EMAIL",
      startsAt: new Date("2026-10-18T13:00:00.000Z"),
    });
    const otherChannel = reminderDedupeKey({
      appointmentId: "a-1",
      channel: "WHATSAPP",
      startsAt,
    });

    expect(again).toBe(first);
    expect(moved).not.toBe(first);
    expect(otherChannel).not.toBe(first);
  });

  it("carries no contact datum", () => {
    const key = reminderDedupeKey({ appointmentId: "a-1", channel: "EMAIL", startsAt });
    expect(key).not.toMatch(/@/);
  });
});
