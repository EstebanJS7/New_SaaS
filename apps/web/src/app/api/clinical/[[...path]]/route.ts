import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

const CLINICAL_PATH_PREFIX = "/api/clinical";

/** Canonical UUID shape required by the upstream clinical route params. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClinicalMethod = "GET" | "POST" | "PUT";

/** Placeholder marking a UUID identifier slot in a route shape. */
const ID_SLOT = ":id";

interface ClinicalRouteShape {
  readonly segments: readonly string[];
  readonly methods: readonly ClinicalMethod[];
}

/**
 * Allowlisted clinical sub-routes relative to the Patient anchor. The `":id"`
 * placeholder marks an identifier slot; the method list mirrors the upstream
 * controller contract.
 *
 * This allowlist is the proxy's security boundary: a segment that is not an
 * exact static literal or a well-formed UUID — a traversal segment, a
 * percent-encoded byte, or any unknown route — can never reach the upstream URL.
 */
const CLINICAL_ROUTE_SHAPES: readonly ClinicalRouteShape[] = [
  { segments: ["encounters"], methods: ["GET", "POST"] },
  { segments: ["encounters", ID_SLOT], methods: ["GET", "PUT"] },
  { segments: ["encounters", ID_SLOT, "close"], methods: ["POST"] },
  { segments: ["encounters", ID_SLOT, "amendments"], methods: ["POST"] },
  { segments: ["treatments"], methods: ["GET", "POST"] },
  { segments: ["treatments", ID_SLOT], methods: ["PUT"] },
  { segments: ["vaccinations"], methods: ["GET", "POST"] },
  { segments: ["vaccinations", ID_SLOT], methods: ["PUT"] },
  { segments: ["deworming"], methods: ["GET", "POST"] },
  { segments: ["deworming", ID_SLOT], methods: ["PUT"] },
  { segments: ["studies"], methods: ["GET", "POST"] },
  { segments: ["studies", ID_SLOT], methods: ["PUT"] },
  { segments: ["weights"], methods: ["GET", "POST"] },
  { segments: ["weights", ID_SLOT], methods: ["PUT"] },
];

type UpstreamResolution =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly status: 400 | 404 };

/**
 * Resolves the browser pathname to a safe upstream path, or a rejection status.
 *
 * The Patient anchor must be a well-formed UUID — `/api/clinical` alone is
 * rejected rather than mapped to an unanchored upstream `/clinical`. The
 * remainder must match an allowlisted route shape for the request method, and
 * every emitted segment is re-encoded, so traversal and encoded-separator
 * input can never reshape the upstream URL.
 */
function resolveUpstreamPath(pathname: string, method: ClinicalMethod): UpstreamResolution {
  const remainder = pathname.startsWith(CLINICAL_PATH_PREFIX)
    ? pathname.slice(CLINICAL_PATH_PREFIX.length)
    : "";
  // A legitimate route never contains a percent escape; reject any encoded byte
  // outright so a decoded separator cannot add or reshape a path segment.
  if (remainder.includes("%")) {
    return { ok: false, status: 400 };
  }

  const segments = remainder.split("/").filter((segment) => segment.length > 0);
  const [patientId, ...rest] = segments;
  if (!patientId || !UUID_PATTERN.test(patientId)) {
    return { ok: false, status: 400 };
  }

  const matched = CLINICAL_ROUTE_SHAPES.find(
    (shape) =>
      shape.segments.length === rest.length &&
      shape.methods.includes(method) &&
      shape.segments.every((expected, index) => {
        const actual = rest[index];
        if (actual === undefined) {
          return false;
        }
        return expected === ID_SLOT ? UUID_PATTERN.test(actual) : expected === actual;
      })
  );
  if (!matched) {
    return { ok: false, status: 404 };
  }

  const encoded = [patientId, ...rest].map((segment) => encodeURIComponent(segment));
  return { ok: true, path: `/patients/${encoded[0]}/clinical/${encoded.slice(1).join("/")}` };
}

/** Stable JSON rejection envelope; no upstream call is made for a rejected path. */
function rejectionResponse(status: 400 | 404): NextResponse {
  const error =
    status === 400
      ? { code: "VALIDATION_FAILED", message: "Invalid clinical request path." }
      : { code: "NOT_FOUND", message: "Clinical route not found." };
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
 * Proxies staff clinical API calls to the private NestJS clinical surface.
 *
 * The web namespace is Patient-anchored: the first path segment is the Patient
 * id and the remainder must match an allowlisted clinical route shape, so
 * `/api/clinical/:patientId/encounters/:id/close` maps to the upstream
 * `/patients/:patientId/clinical/encounters/:id/close`. An empty or malformed
 * Patient anchor, a traversal/encoded segment, an unknown route or a method the
 * upstream contract does not expose is rejected here before any upstream call.
 * Tenant identity is not derived here — the upstream API resolves it from the
 * forwarded session cookie, so a cross-tenant Patient id stays a 404 upstream.
 *
 * Browser headers cross through a strict allowlist: only the authenticated
 * session cookie (read server-side, never from the browser) and `x-request-id`.
 * For mutating verbs the body is piped to the API as the caller's raw
 * `ReadableStream` instead of being buffered, so the API Zod validation sees
 * the exact input; the proxy declares the JSON media type itself because the
 * clinical surface is JSON-only. Upstream status, error envelope,
 * `content-type` and `x-request-id` are preserved and the upstream body is
 * streamed back.
 */
async function proxyClinicalRequest(
  request: NextRequest,
  method: ClinicalMethod
): Promise<NextResponse> {
  const resolution = resolveUpstreamPath(request.nextUrl.pathname, method);
  if (!resolution.ok) {
    return rejectionResponse(resolution.status);
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const headers: Record<string, string> = {
    cookie: cookieStore.toString(),
  };

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
  return proxyClinicalRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyClinicalRequest(request, "POST");
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxyClinicalRequest(request, "PUT");
}
