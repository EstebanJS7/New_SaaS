import { describe, expect, it } from "vitest";
import {
  STAFF_RECOVERY_CHANNEL,
  staffRecoveryDedupeKey,
  staffRecoveryWindow,
} from "./staff-recovery.policy.js";

const PROFILE = "11111111-1111-4111-8111-111111111111";

describe("staff recovery policy", () => {
  it("bounds a window to the hour, in UTC", () => {
    expect(staffRecoveryWindow(new Date("2026-10-17T12:00:00.000Z"))).toBe("2026-10-17T12");
    expect(staffRecoveryWindow(new Date("2026-10-17T12:59:59.999Z"))).toBe("2026-10-17T12");
    // UTC, not local: the window must not move with the server's timezone, or the
    // same request would key differently on two deployments.
    expect(staffRecoveryWindow(new Date("2026-10-17T23:30:00.000Z"))).toBe("2026-10-17T23");
  });

  it("is stable inside an hour and distinct across the boundary", () => {
    const early = staffRecoveryDedupeKey({
      userProfileId: PROFILE,
      now: new Date("2026-10-17T12:00:00.000Z"),
    });
    const late = staffRecoveryDedupeKey({
      userProfileId: PROFILE,
      now: new Date("2026-10-17T12:59:59.999Z"),
    });
    const next = staffRecoveryDedupeKey({
      userProfileId: PROFILE,
      now: new Date("2026-10-17T13:00:00.000Z"),
    });

    expect(early).toBe(late);
    // A different hour is a different message: the window is what keeps a spent
    // delivery from holding the key forever, which would mean exactly one recovery
    // email per profile for the lifetime of the account.
    expect(next).not.toBe(early);
  });

  it("is per profile and on the fixed EMAIL channel", () => {
    const other = staffRecoveryDedupeKey({
      userProfileId: "22222222-2222-4222-8222-222222222222",
      now: new Date("2026-10-17T12:00:00.000Z"),
    });
    expect(other).not.toBe(
      staffRecoveryDedupeKey({ userProfileId: PROFILE, now: new Date("2026-10-17T12:00:00.000Z") })
    );
    expect(STAFF_RECOVERY_CHANNEL).toBe("EMAIL");
  });
});
