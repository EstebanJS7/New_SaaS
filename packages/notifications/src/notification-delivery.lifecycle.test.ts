import { describe, expect, it } from "vitest";
import {
  assertNotificationDeliveryTransition,
  canTransitionNotificationDelivery,
  isNotificationDeliveryFrozen,
  isNotificationDeliverySettled,
  NOTIFICATION_DELIVERY_FROZEN_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_DELIVERY_TRANSITION_NOT_ALLOWED,
  NOTIFICATION_DELIVERY_TRANSITIONS,
  NotificationDeliveryTransitionError,
  type NotificationDeliveryStatus,
} from "./notification-delivery.lifecycle.js";

/**
 * The database's own guard is what enforces the lifecycle; these cases pin the
 * TypeScript mirror so the two cannot drift silently. The SQL side of every edge
 * asserted here is asserted independently in
 * `packages/database/src/schema-notification-delivery.test.ts`.
 */
describe("notification delivery lifecycle", () => {
  const ALL: readonly NotificationDeliveryStatus[] = NOTIFICATION_DELIVERY_STATUSES;

  it("exposes exactly the six statuses the enum declares", () => {
    expect(ALL).toEqual(["SCHEDULED", "QUEUED", "SENDING", "SENT", "FAILED", "CANCELLED"]);
    expect(Object.isFrozen(NOTIFICATION_DELIVERY_STATUSES)).toBe(true);
  });

  it("pins the allowed edges and gives every status an entry", () => {
    expect(NOTIFICATION_DELIVERY_TRANSITIONS).toEqual({
      SCHEDULED: ["QUEUED", "SENDING", "CANCELLED"],
      QUEUED: ["SENDING", "CANCELLED"],
      SENDING: ["SENT", "FAILED"],
      SENT: [],
      FAILED: [],
      CANCELLED: [],
    });

    for (const status of ALL) {
      expect(NOTIFICATION_DELIVERY_TRANSITIONS[status], `${status} needs an entry`).toBeDefined();
    }
  });

  it("admits SCHEDULED -> SENDING, because a lost QUEUED write must not wedge a queued job", () => {
    expect(canTransitionNotificationDelivery("SCHEDULED", "SENDING")).toBe(true);
  });

  it("refuses every non-edge, including the tempting ones", () => {
    for (const [from, to] of [
      ["SCHEDULED", "SENT"],
      ["SCHEDULED", "FAILED"],
      ["QUEUED", "SENT"],
      ["QUEUED", "FAILED"],
      ["SENDING", "QUEUED"],
      ["SENDING", "CANCELLED"],
      ["SENDING", "SCHEDULED"],
      ["FAILED", "SENDING"],
      ["FAILED", "SENT"],
      ["SENT", "FAILED"],
      ["CANCELLED", "SCHEDULED"],
      ["CANCELLED", "QUEUED"],
    ] as readonly (readonly [NotificationDeliveryStatus, NotificationDeliveryStatus])[]) {
      expect(canTransitionNotificationDelivery(from, to), `${from} -> ${to}`).toBe(false);
    }
  });

  it("admits a same-status write unless the row is frozen, which is the lease refresh", () => {
    // This is not an oversight in the guard: a same-status update is how the
    // claim's lease is refreshed and how a retryable failure records its reason
    // while the row stays SENDING for BullMQ's next attempt.
    for (const status of ["SCHEDULED", "QUEUED", "SENDING", "FAILED"] as const) {
      expect(canTransitionNotificationDelivery(status, status), status).toBe(true);
    }
    // ...and freezing is a separate database trigger, not an absence of edges.
    for (const status of NOTIFICATION_DELIVERY_FROZEN_STATUSES) {
      expect(canTransitionNotificationDelivery(status, status), status).toBe(false);
    }
  });

  it("tells settled apart from frozen", () => {
    expect(ALL.filter(isNotificationDeliverySettled)).toEqual(["SENT", "FAILED", "CANCELLED"]);
    // FAILED is settled and writable in place; only SENT and CANCELLED are frozen.
    expect(NOTIFICATION_DELIVERY_FROZEN_STATUSES).toEqual(["SENT", "CANCELLED"]);
    expect(isNotificationDeliveryFrozen("FAILED")).toBe(false);
    expect(isNotificationDeliverySettled("SENDING")).toBe(false);
  });

  it("throws a named, stable error for a refused edge", () => {
    expect(() => assertNotificationDeliveryTransition("SENDING", "CANCELLED")).toThrow(
      NotificationDeliveryTransitionError
    );

    try {
      assertNotificationDeliveryTransition("SENDING", "CANCELLED");
      expect.unreachable("the assertion must throw for a refused edge");
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationDeliveryTransitionError);
      const refusal = error as NotificationDeliveryTransitionError;
      expect(refusal.code).toBe(NOTIFICATION_DELIVERY_TRANSITION_NOT_ALLOWED);
      expect(refusal.from).toBe("SENDING");
      expect(refusal.to).toBe("CANCELLED");
      expect(refusal.message).toBe(
        "notification delivery transition from SENDING to CANCELLED is not allowed"
      );
    }

    expect(() => assertNotificationDeliveryTransition("SENDING", "SENT")).not.toThrow();
  });
});
