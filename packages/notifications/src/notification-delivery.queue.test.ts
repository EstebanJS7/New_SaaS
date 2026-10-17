import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_DELIVERY_BACKOFF_DELAY_MS,
  NOTIFICATION_DELIVERY_JOB,
  NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
  NOTIFICATION_DELIVERY_QUEUE,
  notificationDeliveryJobId,
  notificationDeliveryJobOptions,
  type NotificationDeliveryJob,
} from "./notification-delivery.queue.js";

/**
 * The queue contract is shared by the API producer and the worker consumer, so
 * these cases pin the names and the identity that both sides must agree on.
 */
describe("notification delivery queue contract", () => {
  it("pins the queue name, the job name and the retry budget", () => {
    expect(NOTIFICATION_DELIVERY_QUEUE).toBe("notification-delivery");
    expect(NOTIFICATION_DELIVERY_JOB).toBe("deliver");
    expect(NOTIFICATION_DELIVERY_MAX_ATTEMPTS).toBe(5);
    expect(NOTIFICATION_DELIVERY_BACKOFF_DELAY_MS).toBe(1_000);
  });

  it("derives a deterministic identity from the delivery, and one per delivery", () => {
    expect(notificationDeliveryJobId("abc")).toBe("notification-deliver:abc");
    expect(notificationDeliveryJobId("abc")).toBe(notificationDeliveryJobId("abc"));
    expect(notificationDeliveryJobId("abc")).not.toBe(notificationDeliveryJobId("def"));
  });

  it("delays the job to the delivery's own instant", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    const options = notificationDeliveryJobOptions(
      "abc",
      new Date("2026-10-18T12:00:00.000Z"),
      now
    );

    expect(options.delay).toBe(86_400_000);
    expect(options.jobId).toBe("notification-deliver:abc");
    expect(options.attempts).toBe(NOTIFICATION_DELIVERY_MAX_ATTEMPTS);
    expect(options.backoff).toEqual({ type: "exponential", delay: 1_000 });
  });

  it("clamps a past instant to 'due now' rather than a negative delay", () => {
    const options = notificationDeliveryJobOptions(
      "abc",
      new Date("2026-10-16T12:00:00.000Z"),
      new Date("2026-10-17T12:00:00.000Z")
    );

    expect(options.delay).toBe(0);
  });

  it("keeps the failed set: the row is the record, the queue is the view", () => {
    const options = notificationDeliveryJobOptions("abc", new Date(), new Date());
    expect(options.removeOnComplete).toBe(true);
    expect(options.removeOnFail).toBe(false);
  });

  it("carries stable ids only, so no contact datum can ride in the payload", () => {
    const payload: NotificationDeliveryJob = {
      notificationDeliveryId: "delivery-1",
      tenantId: "tenant-1",
    };

    expect(Object.keys(payload).sort()).toEqual(["notificationDeliveryId", "tenantId"]);
    // The recipient is a REFERENCE on the row; the channel boundary resolves it
    // to RESTRICTED contact data at send time (PRD §41).
    expect(JSON.stringify(payload)).not.toMatch(/@|\+[0-9]/);
  });
});
