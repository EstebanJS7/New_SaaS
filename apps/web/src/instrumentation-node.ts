/**
 * DEC-093 — the Node.js half of `instrumentation.ts`. Kept in its own module so
 * only the Node.js server bundle ever imports the error-tracking SDK; the edge
 * middleware and the browser never load it.
 */
import { captureError, initErrorTracking } from "@newsaas/observability";

export function startErrorTracking(): void {
  initErrorTracking({
    service: "web",
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.SENTRY_RELEASE,
  });
}

export function reportRequestError(error: unknown, requestId: string | undefined): void {
  captureError(error, requestId === undefined ? {} : { requestId });
}
