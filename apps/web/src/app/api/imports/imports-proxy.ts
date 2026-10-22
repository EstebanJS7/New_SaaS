import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * The staff imports BFF ([[IMP-005]], EPIC-19).
 *
 * `/api/imports` and its sub-paths map one-to-one onto the private API's six
 * import routes. The API surface is EXACTLY those six — the multipart upload, the
 * two phase triggers, the bounded list, the single read and the result summary —
 * and this boundary is a CLOSED allowlist of `(method, path shape)` pairs rather
 * than a catch-all tunnel: anything outside the table is refused HERE, before a
 * credential is read and before any upstream call.
 *
 * ## The two bodies this boundary handles
 *
 * - **multipart** (the upload only): `await request.formData()` is forwarded as
 *   the fetch body and NO `content-type` header is set, so `fetch` writes its own
 *   multipart boundary. This is the branding-asset precedent
 *   (`app/api/branding/assets/[kind]/route.ts`) applied unchanged; setting the
 *   header by hand would truncate every upload at the first part.
 * - **none**: preview, commit and every read carry no body. The API declares no
 *   `@Body` on the two triggers, so a body sent from the browser is not forwarded
 *   and cannot reach a handler that ignores it anyway.
 *
 * ## The response is buffered as TEXT
 *
 * Every answer — the list, the detail, the summary and the API's own error
 * envelope — is read with `response.text()` and re-emitted with the upstream
 * status and `content-type`. Buffering is the rule the release checklist records
 * and the reports export proxy states at length: re-serializing here could
 * reorder keys, and a streamed pass-through loses the status/header coupling when
 * the upstream fails mid-flight. A `400`, a `403`, a `404` and the lifecycle
 * `409` all reach the browser with the API's own message intact, which is what
 * lets the surface print a refusal verbatim instead of paraphrasing the rule.
 *
 * ## What this boundary does NOT do
 *
 * - **It does not interpret the query VALUES.** `?limit=` and `?offset=` are
 *   forwarded as sent: the ceilings (list `limit` max 100, summary `limit` max
 *   500) and `offset >= 0` are the API's own `imports.zod.ts` contract, and a
 *   second opinion here would be a second bound to keep in sync. The KEYS are
 *   allowlisted per shape, so `?tenantId=` is refused locally: tenant authority is
 *   never a request parameter on this surface, and `Nothing forwards a tenantId`
 *   is enforced by the key set rather than by a filter.
 * - **It does not synthesize a tenant, a permission or a state.** Tenant and
 *   permission authority are resolved by the API from the forwarded session
 *   alone, and the lifecycle is server-owned ([[DEC-072]]): a trigger queues work
 *   and never writes the state it queues for, so there is nothing here to fake.
 * - **It does not generate a storage key or a URL for the artefact.** There is no
 *   route on this surface that returns the uploaded file, by decision
 *   ([[DEC-072]]): the operator already has the file.
 */

const DEFAULT_API_URL = "http://localhost:3001";

/** Root segment of the private API's import surface. */
const API_IMPORTS_PREFIX = "/imports";

/**
 * Canonical UUID shape required by the upstream `:id` param (`importIdParam` in
 * `apps/api/src/imports/imports.zod.ts` is a `z.string().uuid()`).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTTP methods this boundary is willing to forward. */
export type ImportProxyMethod = "GET" | "POST";

/**
 * Method-independent shapes of the imports API surface. A shape is only "known";
 * whether it is reachable also depends on the HTTP method, which is what lets a
 * known path reached with the wrong method answer with a method refusal instead
 * of being conflated with an unknown path.
 */
type ImportPathShape = "collection" | "detail" | "summary" | "preview" | "commit";

/**
 * Method-aware allowlist for the imports proxy. A request is forwarded only when
 * its `(method, shape)` pair is listed here:
 *
 * - `GET  /imports`                  the caller tenant's imports, newest first
 * - `POST /imports`                  the multipart upload ([[IMP-001]])
 * - `GET  /imports/:uuid`            one import with its counters
 * - `GET  /imports/:uuid/summary`    totals + a bounded page of row outcomes
 * - `POST /imports/:uuid/preview`    the explicit preview command ([[IMP-002]])
 * - `POST /imports/:uuid/commit`     the explicit commit command ([[IMP-003]])
 *
 * Deliberately absent, so the request is refused here and never smuggled
 * upstream: `PATCH`, `PUT` and `DELETE` anywhere (the API exposes none, the
 * lifecycle is server-owned, and a re-run is a new import with a new artefact),
 * plus any route that accepts a `state`.
 */
const ALLOWED_IMPORT_ROUTES: Readonly<Record<ImportProxyMethod, ReadonlySet<ImportPathShape>>> = {
  GET: new Set<ImportPathShape>(["collection", "detail", "summary"]),
  POST: new Set<ImportPathShape>(["collection", "preview", "commit"]),
};

/**
 * Query keys each shape accepts, in canonical forward order.
 *
 * Mirrors `importListQuery` (`.strict()`: `limit`, `entity`) and
 * `importSummaryQuery` (`.strict()`: `limit`, `offset`) in
 * `apps/api/src/imports/imports.zod.ts`. Both are CLOSED upstream, so an unknown
 * key is a `400` there; this boundary refuses it outright instead of forwarding
 * a parameter the browser invented — and a key that is not listed here (most of
 * all `tenantId`) never leaves the browser.
 *
 * The API's default is used where the surface sends nothing: the HISTORY asks for
 * no `limit` at all, so the list stays bounded by the contract's own default (50)
 * rather than by a page size this boundary would have to keep in sync.
 */
const IMPORT_QUERY_KEYS: Readonly<Record<ImportPathShape, readonly string[]>> = {
  collection: ["entity", "limit"],
  detail: [],
  summary: ["limit", "offset"],
  preview: [],
  commit: [],
};

/**
 * Uniform not-found: this boundary never reveals whether an import exists.
 *
 * A path whose `:id` slot is not a canonical UUID lands here rather than in a
 * `400`, which is the convention the sales and scheduling proxies already state
 * ("a malformed id can never fill the UUID slot"). The id is therefore validated
 * BEFORE any upstream call — a non-UUID never costs the API a request — and the
 * answer is the same one an unknown path gets, so the proxy is not an oracle for
 * which ids are well-formed either.
 */
function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Import route was not found." } },
    { status: 404 }
  );
}

/**
 * Uniform method refusal for a path the API does expose. Same envelope shape as
 * {@link notFound}, and it deliberately sets no `Allow` header, so the caller
 * cannot enumerate the other methods a path supports.
 */
function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    {
      error: { code: "METHOD_NOT_ALLOWED", message: "Import route does not support this method." },
    },
    { status: 405 }
  );
}

/**
 * Structural rejection: the path is malformed (a percent escape, an empty
 * segment, or a `.`/`..` segment) rather than a request for a route that does not
 * exist. Refusing it is what keeps "the matched shape is the requested path"
 * true, so an encoded separator cannot be decoded onto a real route.
 */
function invalidPath(): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_FAILED", message: "Invalid import request path." } },
    { status: 400 }
  );
}

/**
 * Query rejection, built from the shape's OWN key list so the message never
 * reflects caller input back. `VALIDATION_FAILED` is the code the API answers
 * `importListQuery`/`importSummaryQuery` with, so a local refusal and an upstream
 * one are the same rejection to a caller that branches on the code.
 */
function unsupportedQueryKey(accepted: readonly string[]): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_FAILED",
        message: `An import query accepts only: ${accepted.join(", ")}.`,
      },
    },
    { status: 400 }
  );
}

/**
 * Rejection for a request that carries no staff session. The private API answers
 * a missing session with this exact `401 UNAUTHENTICATED` envelope; this boundary
 * refuses it earlier only because there is no credential to forward. A portal
 * cookie can never satisfy this: the two cookie families are separate and the
 * portal cookie is not read here.
 */
function unauthenticated(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "Authentication required." } },
    { status: 401 }
  );
}

/**
 * Rejection for an upload whose body this boundary cannot even parse.
 *
 * The API refuses a non-multipart upload with this exact sentence
 * (`IMPORT_ARTEFACT_MULTIPART_MESSAGE` in `import-artefact.pipe.ts`); it is
 * repeated here because `request.formData()` THROWS on a body that is not
 * multipart, and a thrown parse error would surface as a `500` for a condition the
 * contract already names. This is the transport refusal and nothing more: the
 * size cap, the CSV allowlist and the by-name spreadsheet refusal stay the API's
 * own, so their messages reach the operator verbatim.
 */
function invalidMultipart(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_FAILED",
        message: "An import must be uploaded as a multipart/form-data request.",
      },
    },
    { status: 400 }
  );
}

type ImportPathMatch =
  | { readonly ok: true; readonly shape: ImportPathShape; readonly segments: readonly string[] }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Classifies the path segments into a known shape, or answers the rejection:
 *
 * - a malformed segment is a `400` (see {@link invalidPath});
 * - an id slot that is not a UUID, an unknown trailing segment, or a deeper path
 *   is a `404` (see {@link notFound});
 * - `[]` — `/api/imports` on its own — is the collection: the list on `GET`, the
 *   upload on `POST`.
 *
 * Method-independent on purpose, so "unknown path" and "known path, wrong
 * method" stay distinguishable by the caller.
 */
function matchImportPath(segments: readonly string[]): ImportPathMatch {
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".." || segment.includes("%")
    )
  ) {
    return { ok: false, response: invalidPath() };
  }

  if (segments.length === 0) {
    return { ok: true, shape: "collection", segments };
  }

  const [first, second, ...rest] = segments;
  if (first === undefined || !UUID_PATTERN.test(first)) {
    return { ok: false, response: notFound() };
  }
  if (segments.length === 1) {
    return { ok: true, shape: "detail", segments };
  }
  if (rest.length > 0) {
    return { ok: false, response: notFound() };
  }
  switch (second) {
    case "summary":
      return { ok: true, shape: "summary", segments };
    case "preview":
      return { ok: true, shape: "preview", segments };
    case "commit":
      return { ok: true, shape: "commit", segments };
    default:
      return { ok: false, response: notFound() };
  }
}

/**
 * Rebuilds the upstream query string from the allowlist, or `null` when the
 * requested query is out of contract.
 *
 * Only a `GET` accepts a query at all, and only on the shapes whose key list
 * above is non-empty: a query on the detail read, on a trigger or on the upload
 * is refused (never dropped silently), so the proxy cannot become a query tunnel.
 * The string is rebuilt from the allowlist rather than forwarded verbatim, so a
 * duplicate key collapses to its first value and every value is percent-encoded
 * by `URLSearchParams`.
 */
function resolveImportQuery(
  searchParams: URLSearchParams,
  shape: ImportPathShape,
  method: ImportProxyMethod
): string | null {
  const sentKeys = [...searchParams.keys()];
  if (sentKeys.length === 0) {
    return "";
  }
  const accepted = IMPORT_QUERY_KEYS[shape];
  if (method !== "GET" || accepted.length === 0) {
    return null;
  }
  if (sentKeys.some((key) => !accepted.includes(key))) {
    return null;
  }
  const forwarded = new URLSearchParams();
  for (const key of accepted) {
    const value = searchParams.get(key);
    if (value !== null && value.length > 0) {
      forwarded.set(key, value);
    }
  }
  const query = forwarded.toString();
  return query.length > 0 ? `?${query}` : "";
}

/**
 * Proxies one staff import request to the private API.
 *
 * `segments` is the catch-all remainder of `/api/imports` (Next.js hands the
 * decoded segments to the route handler). The order of the checks is deliberate:
 * the path is matched first (so a malformed or unknown path is never even
 * classified as a method problem), the method second (a wrong verb on a known
 * path is the more fundamental refusal, and the query allowlist of a shape that
 * method cannot reach is not a rule a caller could satisfy), the query third, and
 * the credential last — a request this boundary already refuses never costs a
 * cookie read.
 *
 * Browser headers cross through a strict allowlist: the staff session cookie (read
 * server-side by name, never the whole jar) and `x-request-id`. No tenant, role or
 * permission header is ever synthesized, and the upload's `content-type` is left
 * unset so `fetch` writes its own multipart boundary.
 */
export async function proxyImportRequest(
  request: NextRequest,
  method: ImportProxyMethod,
  segments: readonly string[] | undefined
): Promise<NextResponse> {
  const match = matchImportPath(segments ?? []);
  if (!match.ok) {
    return match.response;
  }

  if (!ALLOWED_IMPORT_ROUTES[method].has(match.shape)) {
    return methodNotAllowed();
  }

  const query = resolveImportQuery(request.nextUrl.searchParams, match.shape, method);
  if (query === null) {
    return unsupportedQueryKey(IMPORT_QUERY_KEYS[match.shape]);
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  // Only the staff cookie is consulted: a portal cookie cannot authenticate an
  // import, and an empty value is no credential either.
  if (session === undefined || session.value.length === 0) {
    return unauthenticated();
  }

  /**
   * The upload is the ONE shape that carries a body, and it is forwarded as the
   * parsed multipart form. `undefined` for everything else, which is also why the
   * two triggers cannot smuggle a payload the API would ignore.
   */
  let body: FormData | undefined;
  if (method === "POST" && match.shape === "collection") {
    try {
      body = await request.formData();
    } catch {
      return invalidMultipart();
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const headers: Record<string, string> = {
    cookie: `${STAFF_SESSION_COOKIE}=${session.value}`,
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  const upstreamSegments = [API_IMPORTS_PREFIX.slice(1), ...match.segments].map((segment) =>
    encodeURIComponent(segment)
  );
  const response = await fetch(`${apiUrl}/${upstreamSegments.join("/")}${query}`, {
    method,
    headers,
    body,
    cache: "no-store",
  });

  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };

  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) {
    responseHeaders["x-request-id"] = responseRequestId;
  }

  // Buffered as text, not streamed: the payloads on this surface are bounded JSON
  // documents (a capped list, one import, one page of row outcomes), and buffering
  // is what keeps the status, the content-type and the exact bytes together.
  const responseBody = await response.text();
  return new NextResponse(responseBody, {
    status: response.status,
    headers: responseHeaders,
  });
}
