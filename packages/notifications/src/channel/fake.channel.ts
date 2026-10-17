import {
  NOTIFICATION_CHANNEL_REASON,
  type NotificationChannel,
  type NotificationChannelOutcome,
  type NotificationChannelPort,
  type NotificationChannelRequest,
} from "./channel.port.js";
/** What the fake is told to answer, in order; the last entry repeats. */
export const FAKE_CHANNEL_OUTCOMES = Object.freeze([
  "SENT",
  /** A transport-level failure: the queue may retry it. */
  "RETRYABLE_FAILURE",
  /** The provider rejected the message: retrying it changes nothing. */
  "PERMANENT_FAILURE",
] as const);

export type FakeChannelOutcome = (typeof FAKE_CHANNEL_OUTCOMES)[number];

/**
 * How many attempts the fake retains.
 *
 * Bounded because the fake is **selectable in production** for the documented
 * demo path: unbounded, a long-lived process would hold a RESTRICTED datum for
 * every delivery it ever sent (TD-040 R3-004). The provider reference keeps
 * counting past this window, which is why the counter is separate from the log.
 */
export const FAKE_CHANNEL_RETAINED_ATTEMPTS = 100;

export interface FakeNotificationChannelOptions {
  readonly channel: NotificationChannel;
  readonly outcomes?: readonly FakeChannelOutcome[];
  readonly providerReferencePrefix?: string;
  readonly clock?: () => Date;
}

/** One attempt the fake was asked to make. */
export interface FakeChannelAttempt {
  readonly tenantId: string;
  readonly deliveryId: string;
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  readonly parameters: readonly string[];
  readonly at: string;
}

/**
 * The deterministic channel fake, and the ONLY reason the boundary is testable
 * without a network.
 *
 * It is deterministic in the way [[DEC-061]] requires: the same scripted outcome
 * for the same call index, a clock the caller supplies, no randomness, no
 * network, no wall-clock dependence. The automated evidence for the whole
 * channel boundary is this object's.
 *
 * **It is also selectable in production for the documented dedicated-demo path**
 * (the `FISCAL_PROVIDER` precedent), so one property has to be stated rather
 * than assumed: `attempts` is the only place a recipient datum is retained
 * anywhere in this package, it is retained **in memory only**, for assertions,
 * and the fake never writes it to a log, a rejection or an error. A deployment
 * that selects the fake is a deployment that accepts an in-memory record of what
 * it would have sent.
 */
export class FakeNotificationChannel implements NotificationChannelPort {
  readonly providerId = "FAKE";
  /** The last {@link FAKE_CHANNEL_RETAINED_ATTEMPTS} attempts. */
  private readonly attemptsLog: FakeChannelAttempt[] = [];
  /** Monotonic, and deliberately NOT the log's length: the log is bounded. */
  private calls = 0;
  private readonly outcomes: readonly FakeChannelOutcome[];
  private readonly providerReferencePrefix: string;
  private readonly clock: () => Date;

  constructor(private readonly options: FakeNotificationChannelOptions) {
    this.outcomes = options.outcomes?.length ? options.outcomes : ["SENT"];
    this.providerReferencePrefix = options.providerReferencePrefix ?? "fake";
    this.clock = options.clock ?? (() => new Date());
  }

  /** The retained attempts, oldest first. In-memory only, and never logged. */
  get attempts(): readonly FakeChannelAttempt[] {
    return this.attemptsLog;
  }

  send(request: NotificationChannelRequest): Promise<NotificationChannelOutcome> {
    this.calls += 1;
    const index = this.calls;
    this.attemptsLog.push({
      tenantId: request.tenantId,
      deliveryId: request.deliveryId,
      recipient: request.recipient,
      subject: request.subject,
      body: request.body,
      parameters: [...request.parameters],
      at: this.clock().toISOString(),
    });
    if (this.attemptsLog.length > FAKE_CHANNEL_RETAINED_ATTEMPTS) {
      this.attemptsLog.shift();
    }

    const outcome = this.outcomes[Math.min(index - 1, this.outcomes.length - 1)];
    switch (outcome) {
      case "SENT":
        return Promise.resolve({
          outcome: "SENT",
          providerReference: `${this.providerReferencePrefix}-${this.options.channel.toLowerCase()}-${index}`,
        });
      case "RETRYABLE_FAILURE":
        return Promise.resolve({
          outcome: "FAILED",
          retryable: true,
          reasonCode: "FAKE_TRANSPORT_FAILURE",
          // Never the recipient: a failure reason is a coordinate, not content.
          reason: "Simulated transport failure",
        });
      case "PERMANENT_FAILURE":
        return Promise.resolve({
          outcome: "FAILED",
          retryable: false,
          reasonCode: NOTIFICATION_CHANNEL_REASON.REJECTED,
          reason: "Simulated provider rejection",
        });
    }
  }
}

export function createFakeNotificationChannel(
  options: FakeNotificationChannelOptions
): FakeNotificationChannel {
  return new FakeNotificationChannel(options);
}
