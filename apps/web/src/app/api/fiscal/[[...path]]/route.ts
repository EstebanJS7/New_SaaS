import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";
const DEFAULT_API_URL = "http://localhost:3001";
const WEB_FISCAL_PREFIX = "/api/fiscal";
type FiscalMethod = "GET" | "POST" | "PUT";
type FiscalPathShape =
  | "fiscalList"
  | "fiscalItem"
  | "fiscalIssue"
  | "fiscalCancel"
  | "profileRead"
  | "profileSave"
  | "issuancePointDeclare"
  | "establishmentList"
  | "establishmentCreate"
  | "establishmentUpdate"
  | "rangeList"
  | "rangeCreate"
  | "rangeRetire"
  | "secretRead"
  | "certificateUpload"
  | "secretRetire"
  | "cscLoad"
  | "taxList"
  | "taxSave";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Contracted JSON bodies stop here; the certificate upload keeps streaming. */
const FISCAL_JSON_BODY_MAX_BYTES = 64 * 1024;
const FISCAL_JSON_BODY_LIMIT_MESSAGE = `Fiscal request body exceeds ${FISCAL_JSON_BODY_MAX_BYTES} bytes.`;
/** A path segment that must be a resource id; it travels only as a UUID. */
const ID_SEGMENT = ":id";
interface FiscalRoute {
  readonly method: FiscalMethod;
  readonly segments: readonly string[];
  readonly shape: FiscalPathShape;
  /** The API prefix: the documents controller is `/fiscal-documents`, FISC-011's is `/fiscal`. */
  readonly upstreamPrefix: "" | "/fiscal";
}
/**
 * The ALLOWLIST: every pair this proxy forwards, and nothing else. FISC-018 adds the
 * fiscal settings screen's routes (profile, issuance point, establishments, ranges
 * list/create/retire) with the API's own methods. FISC-019 adds secret metadata,
 * CSC and streamed certificate uploads; FISC-020 adds tax declarations. Range
 * void stays API-only.
 */
const FISCAL_ROUTES: readonly FiscalRoute[] = [
  { method: "GET", segments: ["signing-material"], shape: "secretRead", upstreamPrefix: "/fiscal" },
  {
    method: "POST",
    segments: ["signing-material"],
    shape: "certificateUpload",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "POST",
    segments: ["signing-material", ID_SEGMENT, "retire"],
    shape: "secretRetire",
    upstreamPrefix: "/fiscal",
  },
  { method: "GET", segments: ["csc"], shape: "secretRead", upstreamPrefix: "/fiscal" },
  { method: "POST", segments: ["csc"], shape: "cscLoad", upstreamPrefix: "/fiscal" },
  {
    method: "POST",
    segments: ["csc", ID_SEGMENT, "retire"],
    shape: "secretRetire",
    upstreamPrefix: "/fiscal",
  },
  { method: "GET", segments: ["tax-classifications"], shape: "taxList", upstreamPrefix: "/fiscal" },
  {
    method: "PUT",
    segments: ["tax-classifications", ":rateCode"],
    shape: "taxSave",
    upstreamPrefix: "/fiscal",
  },
  { method: "GET", segments: ["fiscal-documents"], shape: "fiscalList", upstreamPrefix: "" },
  { method: "POST", segments: ["fiscal-documents"], shape: "fiscalIssue", upstreamPrefix: "" },
  {
    method: "GET",
    segments: ["fiscal-documents", ID_SEGMENT],
    shape: "fiscalItem",
    upstreamPrefix: "",
  },
  {
    method: "POST",
    segments: ["fiscal-documents", ID_SEGMENT, "cancel"],
    shape: "fiscalCancel",
    upstreamPrefix: "",
  },
  {
    method: "GET",
    segments: ["emitter-profile"],
    shape: "profileRead",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "PUT",
    segments: ["emitter-profile"],
    shape: "profileSave",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "PUT",
    segments: ["emitter-profile", "issuance-point"],
    shape: "issuancePointDeclare",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "GET",
    segments: ["establishments"],
    shape: "establishmentList",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "POST",
    segments: ["establishments"],
    shape: "establishmentCreate",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "PUT",
    segments: ["establishments", ID_SEGMENT],
    shape: "establishmentUpdate",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "GET",
    segments: ["timbrado-ranges"],
    shape: "rangeList",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "POST",
    segments: ["timbrado-ranges"],
    shape: "rangeCreate",
    upstreamPrefix: "/fiscal",
  },
  {
    method: "POST",
    segments: ["timbrado-ranges", ID_SEGMENT, "retire"],
    shape: "rangeRetire",
    upstreamPrefix: "/fiscal",
  },
];
const FISCAL_QUERY_KEYS: Partial<Record<FiscalPathShape, readonly string[]>> = {
  fiscalList: ["status"],
};
const PROFILE_KEYS = [
  "ruc",
  "checkDigit",
  "taxpayerType",
  "regimeCode",
  "legalName",
  "tradeName",
  "responsibleIssuer",
  "transactionType",
  "taxType",
  "emissionType",
  "activities",
] as const;
const ESTABLISHMENT_KEYS = [
  "code",
  "addressLine",
  "houseNumber",
  "addressComplement1",
  "addressComplement2",
  "departmentCode",
  "district",
  "cityCode",
  "cityName",
  "phone",
  "email",
  "branchName",
] as const;
const ESTABLISHMENT_CONTRACT = { keys: ESTABLISHMENT_KEYS, message: "Invalid establishment body." };
/**
 * The top-level keys each body may carry. Values are the API's Zod to validate; a
 * PRESENT body with any other key (a `tenantId`, a `status`) is refused here.
 */
const FISCAL_BODY_CONTRACTS: Partial<
  Record<FiscalPathShape, { keys: readonly string[]; message: string }>
> = {
  fiscalIssue: { keys: ["invoiceId"], message: "Invalid fiscal document create body." },
  fiscalCancel: { keys: ["reason"], message: "Invalid fiscal document cancel body." },
  profileSave: { keys: PROFILE_KEYS, message: "Invalid emitter fiscal profile body." },
  issuancePointDeclare: {
    keys: ["establishmentId", "expeditionPoint", "documentType"],
    message: "Invalid issuance point declaration body.",
  },
  establishmentCreate: ESTABLISHMENT_CONTRACT,
  establishmentUpdate: ESTABLISHMENT_CONTRACT,
  rangeCreate: {
    keys: [
      "establishmentId",
      "expeditionPoint",
      "documentType",
      "series",
      "timbradoNumber",
      "rangeFrom",
      "rangeTo",
      "validityStart",
    ],
    message: "Invalid timbrado range body.",
  },
  rangeRetire: { keys: ["reason"], message: "Invalid retirement body." },
  secretRetire: { keys: ["reason"], message: "Invalid retirement body." },
  cscLoad: { keys: ["environment", "idCsc", "value"], message: "Invalid CSC body." },
  taxSave: {
    keys: ["affectation", "proportionality"],
    message: "Invalid tax classification body.",
  },
};
function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Fiscal route was not found." } },
    { status: 404 }
  );
}
function invalidPath(): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_FAILED", message: "Invalid fiscal request path." } },
    { status: 400 }
  );
}
function invalidBody(message: string): NextResponse {
  return NextResponse.json({ error: { code: "VALIDATION_FAILED", message } }, { status: 400 });
}
function payloadTooLarge(): NextResponse {
  return NextResponse.json(
    { error: { code: "PAYLOAD_TOO_LARGE", message: FISCAL_JSON_BODY_LIMIT_MESSAGE } },
    { status: 413 }
  );
}
function unauthenticated(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "Authentication required." } },
    { status: 401 }
  );
}
function methodNotAllowed(allow: readonly FiscalMethod[]): NextResponse {
  return NextResponse.json(
    {
      error: { code: "METHOD_NOT_ALLOWED", message: "Fiscal route does not accept this method." },
    },
    { status: 405, headers: { allow: allow.join(", ") } }
  );
}
type ShapeMatch =
  { route: FiscalRoute } | { invalidId: true } | { allow: readonly FiscalMethod[] } | null;
function shapeMatches(route: FiscalRoute, segments: readonly string[]): "valid" | "badId" | null {
  if (route.segments.length !== segments.length) return null;
  const literalsMatch = route.segments.every(
    (expected, index) =>
      expected === ID_SEGMENT || expected === ":rateCode" || expected === segments[index]
  );
  if (!literalsMatch) return null;
  const idsValid = route.segments.every((expected, index) =>
    expected === ID_SEGMENT
      ? UUID.test(segments[index] ?? "")
      : expected !== ":rateCode" || /^[A-Z0-9_]{1,50}$/.test(segments[index] ?? "")
  );
  return idsValid ? "valid" : "badId";
}
/**
 * The route a request matches. A path that matches a route except for a non-UUID
 * id is a 400 (the id is malformed); a path or method no route admits is a 404 —
 * except a PUT on a valid `fiscal-documents` shape, which is a 405 with `Allow`:
 * the answer Next.js gave before FISC-018 exported `PUT` from this proxy.
 */
function matchFiscalRoute(segments: readonly string[], method: FiscalMethod): ShapeMatch {
  let invalidId = false;
  for (const route of FISCAL_ROUTES) {
    if (route.method !== method) continue;
    const match = shapeMatches(route, segments);
    if (match === "valid") return { route };
    if (match === "badId") invalidId = true;
  }
  if (invalidId) return { invalidId: true };
  if (method === "PUT" && segments[0] === "fiscal-documents") {
    const allow = FISCAL_ROUTES.filter((route) => shapeMatches(route, segments) === "valid").map(
      (route) => route.method
    );
    if (allow.length > 0) return { allow };
  }
  return null;
}
function resolveFiscalQuery(
  params: URLSearchParams,
  shape: FiscalPathShape,
  method: FiscalMethod
): string | null {
  const keys = [...params.keys()];
  if (keys.length === 0) return "";
  const allowed = FISCAL_QUERY_KEYS[shape] ?? [];
  if (method !== "GET" || keys.some((key) => !allowed.includes(key))) return null;
  const forwarded = new URLSearchParams();
  for (const key of allowed) {
    const value = params.get(key);
    if (value !== null && value.length > 0) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  return query ? `?${query}` : "";
}
type PathResolution =
  { ok: true; path: string; shape: FiscalPathShape } | { ok: false; response: NextResponse };
function resolveFiscalPath(request: NextRequest, method: FiscalMethod): PathResolution {
  const { pathname } = request.nextUrl;
  if (pathname !== WEB_FISCAL_PREFIX && !pathname.startsWith(`${WEB_FISCAL_PREFIX}/`))
    return { ok: false, response: notFound() };
  const remainder = pathname.slice(WEB_FISCAL_PREFIX.length);
  if (remainder.includes("%")) return { ok: false, response: invalidPath() };
  const segments = remainder.length === 0 ? [] : remainder.slice(1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".."))
    return { ok: false, response: invalidPath() };
  const match = matchFiscalRoute(segments, method);
  if (match === null) return { ok: false, response: notFound() };
  if ("invalidId" in match) return { ok: false, response: invalidPath() };
  if ("allow" in match) return { ok: false, response: methodNotAllowed(match.allow) };
  const { shape, upstreamPrefix } = match.route;
  const query = resolveFiscalQuery(request.nextUrl.searchParams, shape, method);
  if (query === null) return { ok: false, response: notFound() };
  return {
    ok: true,
    path: `${upstreamPrefix}/${segments.map(encodeURIComponent).join("/")}${query}`,
    shape,
  };
}
function parseJsonObject(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
/** The length a client declares, or 0 when absent or not a plain byte count. */
function declaredBodyBytes(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 0;
  const declared = Number(value);
  return Number.isFinite(declared) ? declared : 0;
}
type BoundedBodyRead = { ok: true; text: string } | { ok: false; response: NextResponse };
/**
 * Reads a contracted JSON body as a stream so an oversized request is refused
 * without ever buffering it. `content-length` is only an early hint: a chunked
 * request carries none and a client can lie, so the bytes actually read decide.
 * The body is decoded non-fatally, exactly as `request.text()` did, so a
 * within-limit request reaches the API through the same text as before.
 */
async function readBoundedJsonBody(request: NextRequest): Promise<BoundedBodyRead> {
  if (declaredBodyBytes(request.headers.get("content-length")) > FISCAL_JSON_BODY_MAX_BYTES)
    return { ok: false, response: payloadTooLarge() };
  const stream = request.body;
  if (stream === null) return { ok: true, text: "" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > FISCAL_JSON_BODY_MAX_BYTES) {
      // Stop the client mid-upload instead of draining bytes we will not forward.
      await reader.cancel().catch(() => undefined);
      return { ok: false, response: payloadTooLarge() };
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}
async function resolveFiscalBody(
  request: NextRequest,
  shape: FiscalPathShape,
  method: FiscalMethod
): Promise<{ ok: true; body: string | undefined } | { ok: false; response: NextResponse }> {
  const contract = FISCAL_BODY_CONTRACTS[shape];
  if (method === "GET" || contract === undefined) return { ok: true, body: undefined };
  const read = await readBoundedJsonBody(request);
  if (!read.ok) return read;
  const text = read.text;
  if (!text.trim()) return { ok: true, body: undefined };
  const parsed = parseJsonObject(text);
  if (parsed === null || Object.keys(parsed).some((key) => !contract.keys.includes(key)))
    return { ok: false, response: invalidBody(contract.message) };
  return { ok: true, body: text };
}
async function proxyFiscalRequest(
  request: NextRequest,
  method: FiscalMethod
): Promise<NextResponse> {
  const resolution = resolveFiscalPath(request, method);
  if (!resolution.ok) return resolution.response;
  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  if (session === undefined || session.value.length === 0) return unauthenticated();
  const multipart = resolution.shape === "certificateUpload";
  const contentType = request.headers.get("content-type") ?? "";
  if (
    multipart &&
    (!/^multipart\/form-data\s*;/i.test(contentType) ||
      !/boundary=/i.test(contentType) ||
      !request.body)
  ) {
    return invalidBody("A multipart signing container is required.");
  }
  // Only the API parses the certificate/password. The BFF never buffers either.
  const bodyResolution = multipart
    ? { ok: true as const, body: request.body ?? undefined }
    : await resolveFiscalBody(request, resolution.shape, method);
  if (!bodyResolution.ok) return bodyResolution.response;
  const headers: Record<string, string> = { cookie: `${STAFF_SESSION_COOKIE}=${session.value}` };
  const requestId = request.headers.get("x-request-id");
  if (requestId) headers["x-request-id"] = requestId;
  if (bodyResolution.body !== undefined)
    headers["content-type"] = multipart ? contentType : "application/json";
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL}${resolution.path}`,
    {
      method,
      headers,
      body: bodyResolution.body,
      cache: "no-store",
      ...(multipart ? { duplex: "half" as const } : {}),
    }
  );
  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };
  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) responseHeaders["x-request-id"] = responseRequestId;
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}
export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyFiscalRequest(request, "GET");
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyFiscalRequest(request, "POST");
}
export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxyFiscalRequest(request, "PUT");
}
