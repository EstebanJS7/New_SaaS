/**
 * DEC-093 — error tracking for the server processes (API, worker, web server).
 *
 * Off by default: nothing is initialised, and nothing leaves the process, unless
 * `SENTRY_DSN` is set. When it is, only unexpected failures are reported — an
 * expected refusal (a 4xx) is product behaviour, not an error.
 *
 * **What an event may carry is decided here, in one place, because this system
 * holds clinical, commercial and fiscal data** (PRD §41). Every event goes
 * through {@link scrubEvent} before it is sent:
 *
 * - no request (no URL query, headers, cookies or body), no user, no extra data;
 * - no breadcrumbs (they record URLs, console lines and queries);
 * - the exception message reduced to its first line, capped, with e-mail
 *   addresses and long digit runs (documents, phones, RUC, amounts) masked —
 *   a Prisma error dumps the whole argument object after its first line;
 * - only the tags this module sets: service, request id, tenant id, job.
 *
 * The request id is what joins an event to the API's own logs and audit trail.
 */

import * as Sentry from "@sentry/node";

export type ObservedService = "api" | "worker" | "web";

export interface ErrorTrackingOptions {
  readonly service: ObservedService;
  /** `SENTRY_DSN`; absent or empty disables error tracking entirely. */
  readonly dsn?: string;
  /** `SENTRY_ENVIRONMENT`, e.g. `production` or `staging`. */
  readonly environment?: string;
  /** `SENTRY_RELEASE`, e.g. the deployed image tag. */
  readonly release?: string;
}

export interface ErrorContext {
  readonly requestId?: string;
  readonly tenantId?: string;
  readonly job?: string;
}

const MESSAGE_MAX_LENGTH = 200;
const ALLOWED_TAGS = new Set(["service", "requestId", "tenantId", "job"]);

let enabled = false;

/** Initialises error tracking once per process. Returns whether it is on. */
export function initErrorTracking(options: ErrorTrackingOptions): boolean {
  if (enabled) return true;
  const dsn = options.dsn?.trim();
  if (dsn === undefined || dsn.length === 0) return false;
  Sentry.init({
    dsn,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.release === undefined ? {} : { release: options.release }),
    // Collect nothing beyond the exception itself (the SDK's own defaults collect
    // headers, cookies, bodies, query strings, queue arguments and frame values).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    maxBreadcrumbs: 0,
    // Errors only: no performance tracing, no profiling, no session replay.
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    initialScope: { tags: { service: options.service } },
  });
  enabled = true;
  return true;
}

/** Whether {@link initErrorTracking} turned error tracking on. */
export function isErrorTrackingEnabled(): boolean {
  return enabled;
}

/** Reports one unexpected failure. A no-op while error tracking is off. */
export function captureError(error: unknown, context: ErrorContext = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context.requestId !== undefined) scope.setTag("requestId", context.requestId);
    if (context.tenantId !== undefined) scope.setTag("tenantId", context.tenantId);
    if (context.job !== undefined) scope.setTag("job", context.job);
    Sentry.captureException(error);
  });
}

/** Waits (bounded) for queued events before a process exits. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}

/** Masks what could identify a person or a document inside a message. */
export function redactText(text: string): string {
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return firstLine
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g, "[email]")
    .replace(/\d[\d.,-]{4,}\d/g, "[número]")
    .slice(0, MESSAGE_MAX_LENGTH);
}

/**
 * The single gate every event passes before it leaves the process. Exported so
 * the rules are tested without a Sentry account.
 */
export function scrubEvent<E extends Sentry.ErrorEvent>(event: E): E {
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.server_name;
  if (event.message !== undefined) event.message = redactText(event.message);
  if (event.logentry?.message !== undefined) {
    event.logentry = { message: redactText(event.logentry.message) };
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = redactText(exception.value);
    // Local variable capture would carry values; frames keep file/line/function only.
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }
  if (event.tags !== undefined) {
    event.tags = Object.fromEntries(
      Object.entries(event.tags).filter(([key]) => ALLOWED_TAGS.has(key))
    );
  }
  if (event.contexts !== undefined) {
    // Runtime/OS contexts are harmless; anything else (a framework's request or
    // state context) is not reviewed, so it does not leave.
    const { os, runtime, app } = event.contexts;
    event.contexts = {
      ...(os ? { os } : {}),
      ...(runtime ? { runtime } : {}),
      ...(app ? { app } : {}),
    };
  }
  return event;
}
