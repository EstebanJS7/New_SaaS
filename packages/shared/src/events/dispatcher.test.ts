import { describe, it, expect, vi } from "vitest";
import { createEventDispatcher } from "./dispatcher.js";
import type { ApplicationEvent } from "./envelope.js";

describe("createEventDispatcher", () => {
  it("publishes an event with id, type, occurredAt, tenantId, aggregateId and payload", () => {
    const dispatcher = createEventDispatcher();

    const event = dispatcher.publish("SaleCompleted", {
      tenantId: "tenant-1",
      aggregateId: "sale-1",
      payload: { total: 100 },
    });

    expect(event.type).toBe("SaleCompleted");
    expect(event.tenantId).toBe("tenant-1");
    expect(event.aggregateId).toBe("sale-1");
    expect(event.payload).toEqual({ total: 100 });
    expect(event.id).toBeTruthy();
    expect(event.occurredAt).toBeTruthy();
  });

  it("delivers published events to matching subscribers", async () => {
    const dispatcher = createEventDispatcher();
    const handler = vi.fn();

    dispatcher.subscribe("SaleCompleted", handler);
    const event = dispatcher.publish("SaleCompleted", {
      tenantId: "tenant-1",
      aggregateId: "sale-1",
      payload: { total: 100 },
    });

    // Subscribers are invoked asynchronously; wait for the microtask queue.
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(handler).toHaveBeenCalledTimes(1);
    const received = handler.mock.calls[0][0] as ApplicationEvent<
      "SaleCompleted",
      { total: number }
    >;
    expect(received.id).toBe(event.id);
    expect(received.type).toBe(event.type);
    expect(received.occurredAt).toBe(event.occurredAt);
    expect(received.tenantId).toBe(event.tenantId);
    expect(received.aggregateId).toBe(event.aggregateId);
    expect(received.payload).toEqual(event.payload);
  });

  it("does not deliver events to subscribers of a different type", async () => {
    const dispatcher = createEventDispatcher();
    const handler = vi.fn();

    dispatcher.subscribe("InvoiceConfirmed", handler);
    dispatcher.publish("SaleCompleted", {
      tenantId: "tenant-1",
      aggregateId: "sale-1",
      payload: { total: 100 },
    });

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering events after unsubscribing", async () => {
    const dispatcher = createEventDispatcher();
    const handler = vi.fn();

    const unsubscribe = dispatcher.subscribe("SaleCompleted", handler);
    unsubscribe();

    dispatcher.publish("SaleCompleted", {
      tenantId: "tenant-1",
      aggregateId: "sale-1",
      payload: { total: 100 },
    });

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(handler).not.toHaveBeenCalled();
  });
});
