import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

const SCHEDULING_PATH_PREFIX = "/api/scheduling";

/** Canonical UUID shape required by the upstream appointment route params. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Query parameters the upstream appointment list route accepts. The API rejects
 * unknown query keys (`.strict()`), so the proxy forwards only these and drops
 * everything else — including any parameter an attacker appends.
 */
const ALLOWED_QUERY_KEYS = ["branchId", "patientId", "professionalMembershipId", "status"] as const;

type SchedulingMethod = "GET" | "POST" | "PUT";

/** Placeholder marking a UUID identifier slot in a route shape. */
const ID_SLOT = ":id";

interface SchedulingRouteShape {
  readonly segments: readonly string[];
  readonly methods: readonly SchedulingMethod[];
}

/**
 * Allowlisted scheduling sub-routes, relative to the proxy root. The `":id"`
 * placeholder marks an appointment or booking-request identifier slot; the
 * method list mirrors the upstream `AppointmentsController` and
 * `BookingRequestsController` contracts (no generic status route exists).
 *
 * This allowlist is the proxy's security boundary: a segment that is not an
 * exact static literal or a well-formed UUID — a traversal segment, a
 * percent-encoded byte, or any unknown route — can never reach the upstream URL.
 */
const SCHEDULING_ROUTE_SHAPES: readonly SchedulingRouteShape[] = [
  { segments: ["appointments"], methods: ["GET", "POST"] },
  { segments: ["appointments", "options"], methods: ["GET"] },
  { segments: ["appointments", ID_SLOT], methods: ["GET", "PUT"] },
  { segments: ["appointments", ID_SLOT, "confirm"], methods: ["POST"] },
  { segments: ["appointments", ID_SLOT, "arrive"], methods: ["POST"] },
  { segments: ["appointments", ID_SLOT, "start"], methods: ["POST"] },
  { segments: ["appointments", ID_SLOT, "complete"], methods: ["POST"] },
  { segments: ["appointments", ID_SLOT, "cancel"], methods: ["POST"] },
  { segments: ["appointments", ID_SLOT, "no-show"], methods: ["POST"] },
  { segments: ["booking-requests"], methods: ["GET"] },
  { segments: ["booking-requests", ID_SLOT, "approve"], methods: ["POST"] },
  { segments: ["booking-requests", ID_SLOT, "reject"], methods: ["POST"] },
];

type UpstreamResolution =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly status: 400 | 404 };

/**
 * Builds the upstream query string from the allowlisted filter keys only.
 *
 * Each value is emitted through `URLSearchParams`, which percent-encodes it, so
 * a filter value can never inject a separator or reshape the URL. Keys outside
 * the allowlist are dropped, and the first value of a repeated key wins so a
 * duplicate cannot reach the API as an array-shaped parameter.
 */
function resolveUpstreamQuery(searchParams: URLSearchParams): string {
  const forwarded = new URLSearchParams();
  for (const key of ALLOWED_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value !== null && value.length > 0) {
      forwarded.set(key, value);
    }
  }
  const query = forwarded.toString();
  return query.length > 0 ? `?${query}` : "";
}

/**
 * Resolves the browser pathname to a safe upstream path, or a rejection status.
 *
 * The remainder after `/api/scheduling` must match an allowlisted route shape for
 * the request method, and every emitted segment is re-encoded, so traversal and
 * encoded-separator input can never reshape the upstream URL. Allowlisted query
 * parameters (branch/professional/status filters) are preserved so the agenda
 * list filters still reach the API. Tenant identity is not derived here — the
 * upstream API resolves it from the forwarded session cookie, so a cross-tenant
 * appointment id stays a 404 upstream.
 */
function resolveUpstreamPath(
  pathname: string,
  method: SchedulingMethod,
  searchParams: URLSearchParams
): UpstreamResolution {
  const remainder = pathname.startsWith(SCHEDULING_PATH_PREFIX)
    ? pathname.slice(SCHEDULING_PATH_PREFIX.length)
    : "";
  // A legitimate route never contains a percent escape; reject any encoded byte
  // outright so a decoded separator cannot add or reshape a path segment.
  if (remainder.includes("%")) {
    return { ok: false, status: 400 };
  }

  const segments = remainder.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { ok: false, status: 400 };
  }

  const matched = SCHEDULING_ROUTE_SHAPES.find(
    (shape) =>
      shape.segments.length === segments.length &&
      shape.methods.includes(method) &&
      shape.segments.every((expected, index) => {
        const actual = segments[index];
        if (actual === undefined) {
          return false;
        }
        return expected === ID_SLOT ? UUID_PATTERN.test(actual) : expected === actual;
      })
  );
  if (!matched) {
    return { ok: false, status: 404 };
  }

  const encoded = segments.map((segment) => encodeURIComponent(segment));
  return { ok: true, path: `/${encoded.join("/")}${resolveUpstreamQuery(searchParams)}` };
}

/** Stable JSON rejection envelope; no upstream call is made for a rejected path. */
function rejectionResponse(status: 400 | 404): NextResponse {
  const error =
    status === 400
      ? { code: "VALIDATION_FAILED", message: "Invalid scheduling request path." }
      : { code: "NOT_FOUND", message: "Scheduling route not found." };
  return new NextResponse(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * RequestInit with the `duplex` field required to stream a request body.
 * `duplex` is part of the fetch spec but is absent from the DOM lib types.
 */
type StreamingRequestInit = RequestInit & { duplex?: "half" };

/**
 * Proxies staff appointment API calls to the private NestJS scheduling surface.
 *
 * The web namespace mirrors the upstream scheduling surface:
 * `/api/scheduling/appointments/:id/confirm` maps to the upstream
 * `/appointments/:id/confirm`, and `/api/scheduling/booking-requests/:id/approve`
 * maps to the staff decision route. An empty, unknown,
 * malformed or method-mismatched route is rejected here before any upstream
 * call.
 *
 * Browser headers cross through a strict allowlist: only the authenticated
 * session cookie (read server-side by name, never from the browser) and
 * `x-request-id`. For mutating verbs the body is piped to the API as the
 * caller's raw `ReadableStream` instead of being buffered, so the API Zod
 * validation sees the exact input; the proxy declares the JSON media type
 * itself because the scheduling surface is JSON-only. Upstream status, error
 * envelope, `content-type` and `x-request-id` are preserved and the upstream
 * body is streamed back.
 */
async function proxySchedulingRequest(
  request: NextRequest,
  method: SchedulingMethod
): Promise<NextResponse> {
  const resolution = resolveUpstreamPath(
    request.nextUrl.pathname,
    method,
    request.nextUrl.searchParams
  );
  if (!resolution.ok) {
    return rejectionResponse(resolution.status);
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const headers: Record<string, string> = {};

  // Forward only the staff session cookie; unrelated cookies stay in the
  // browser instead of leaking into the private API request.
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  if (session !== undefined) {
    headers.cookie = `${STAFF_SESSION_COOKIE}=${session.value}`;
  }

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  const hasBody = method === "POST" || method === "PUT";
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const init: StreamingRequestInit = {
    method,
    headers,
    body: hasBody ? (request.body ?? undefined) : undefined,
    cache: "no-store",
    // undici requires `duplex: "half"` whenever the body is a stream.
    duplex: "half",
  };

  const response = await fetch(`${apiUrl}${resolution.path}`, init);

  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };

  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) {
    responseHeaders["x-request-id"] = responseRequestId;
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxySchedulingRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxySchedulingRequest(request, "POST");
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxySchedulingRequest(request, "PUT");
}
