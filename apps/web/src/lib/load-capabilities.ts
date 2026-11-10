import type { Capabilities } from "./capabilities";

/** Bounded so a slow API never holds the whole staff shell. */
const CAPABILITIES_TIMEOUT_MS = 5_000;

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Validates `GET /memberships/me/capabilities` ([[UX-037]]). Anything but two
 * string lists is UNKNOWN (`{}`), never an empty grant.
 */
export function parseCapabilitiesBody(body: unknown): Capabilities {
  if (typeof body !== "object" || body === null) return {};
  const { permissions, features } = body as Record<string, unknown>;
  if (!isStringList(permissions) || !isStringList(features)) return {};
  return { permissions, features };
}

export interface LoadCapabilitiesOptions {
  readonly apiUrl: string;
  /** The incoming request's cookie header, forwarded as-is. */
  readonly cookie: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Loads the caller's own permissions and its clinic's features server-side.
 *
 * Fail-open for UX (S4): a non-2xx answer, a timeout, a network error or a bad
 * body all resolve to UNKNOWN, so the shell behaves as before the endpoint
 * existed and the API keeps refusing what the caller cannot do. A `401`/`403`
 * is not interpreted here: the branding read already gates the shell on those.
 */
export async function loadCapabilities({
  apiUrl,
  cookie,
  fetchImpl = fetch,
  timeoutMs = CAPABILITIES_TIMEOUT_MS,
}: LoadCapabilitiesOptions): Promise<Capabilities> {
  try {
    const response = await fetchImpl(`${apiUrl}/memberships/me/capabilities`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return {};
    return parseCapabilitiesBody(await response.json());
  } catch {
    return {};
  }
}
