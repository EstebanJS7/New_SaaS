/**
 * DEC-093 — error tracking for the web server (server components, route
 * handlers and the BFF proxies). Off unless `SENTRY_DSN` is set.
 *
 * Only the Node.js runtime reports. The `NEXT_RUNTIME` checks wrap the imports
 * themselves (the shape Next documents), so the edge bundle never includes the
 * SDK. Browser-side errors are NOT reported in this stage (DEC-093).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startErrorTracking } = await import("./instrumentation-node");
    startErrorTracking();
  }
}

/**
 * Next calls this for every uncaught server error. Only the request id travels
 * (it joins the event to the API's logs); the path, headers and body do not.
 */
export async function onRequestError(
  error: unknown,
  request: { readonly headers: Readonly<Record<string, string | string[] | undefined>> }
): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("./instrumentation-node");
    const requestId = request.headers["x-request-id"];
    reportRequestError(error, typeof requestId === "string" ? requestId : undefined);
  }
}
