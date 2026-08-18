import { nanoid } from "nanoid";
import type {
  ApplicationEvent,
  ApplicationEventHandler,
  ApplicationEventType,
} from "./envelope.js";

export interface EventDispatcher {
  publish<TType extends string, TPayload>(
    type: TType,
    event: Omit<ApplicationEvent<TType, TPayload>, "id" | "type" | "occurredAt">
  ): ApplicationEvent<TType, TPayload>;

  subscribe<TType extends string, TPayload>(
    type: TType,
    handler: ApplicationEventHandler<TType, TPayload>
  ): () => void;
}

/**
 * Creates an in-process, typed event dispatcher.
 *
 * Subscribers are invoked synchronously in registration order. The dispatcher
 * is intentionally minimal: it does not cross process boundaries, guarantee
 * delivery, or participate in transactions.
 */
export function createEventDispatcher(): EventDispatcher {
  const handlers = new Map<ApplicationEventType, Set<ApplicationEventHandler<string, unknown>>>();

  return {
    publish<TType extends string, TPayload>(
      type: TType,
      partial: Omit<ApplicationEvent<TType, TPayload>, "id" | "type" | "occurredAt">
    ): ApplicationEvent<TType, TPayload> {
      const event: ApplicationEvent<TType, TPayload> = {
        id: nanoid(),
        type,
        occurredAt: new Date().toISOString(),
        tenantId: partial.tenantId,
        aggregateId: partial.aggregateId,
        payload: partial.payload,
      };

      const typeHandlers = handlers.get(type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          // Fire-and-forget; handlers are responsible for their own error handling.
          void (async () => handler(event))();
        }
      }

      return event;
    },

    subscribe<TType extends string, TPayload>(
      type: TType,
      handler: ApplicationEventHandler<TType, TPayload>
    ): () => void {
      if (!handlers.has(type)) {
        handlers.set(type, new Set());
      }

      const set = handlers.get(type)!;
      const wrapped = handler as ApplicationEventHandler<string, unknown>;
      set.add(wrapped);

      return () => {
        set.delete(wrapped);
      };
    },
  };
}
