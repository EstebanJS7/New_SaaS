/**
 * Type-safe application event envelope used for post-commit, in-process
 * reactions across bounded contexts.
 *
 * Events carry stable identifiers and minimal metadata. They never replace
 * database transactions or explicit orchestration.
 */
export interface ApplicationEvent<TType extends string, TPayload> {
  /** Stable event identifier. */
  id: string;
  /** Event type name (e.g. `SaleCompleted`). */
  type: TType;
  /** ISO-8601 timestamp in UTC. */
  occurredAt: string;
  /** Owning tenant, or null for platform-level events. */
  tenantId: string | null;
  /** Domain aggregate that produced the event. */
  aggregateId: string;
  /** Event payload — keep small and non-sensitive. */
  payload: TPayload;
}

/** All known application event type names. */
export type ApplicationEventType = string;

/** Handler signature for application events. */
export type ApplicationEventHandler<TType extends string, TPayload> = (
  event: ApplicationEvent<TType, TPayload>
) => void | Promise<void>;
