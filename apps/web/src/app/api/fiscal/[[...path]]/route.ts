import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";
const DEFAULT_API_URL = "http://localhost:3001";
const WEB_FISCAL_PREFIX = "/api/fiscal";
type FiscalMethod = "GET" | "POST";
type FiscalPathShape = "fiscalList" | "fiscalItem" | "fiscalIssue" | "fiscalCancel";
const FISCAL_QUERY_KEYS: Readonly<Record<FiscalPathShape, readonly string[]>> = {
  fiscalList: ["status"],
  fiscalItem: [],
  fiscalIssue: [],
  fiscalCancel: [],
};
const FISCAL_BODY_CONTRACTS: Partial<
  Record<FiscalPathShape, { keys: readonly string[]; message: string }>
> = {
  fiscalIssue: { keys: ["invoiceId"], message: "Invalid fiscal document create body." },
  fiscalCancel: { keys: ["reason"], message: "Invalid fiscal document cancel body." },
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
function unauthenticated(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "Authentication required." } },
    { status: 401 }
  );
}
function fiscalPathShape(
  segments: readonly string[],
  method: FiscalMethod
): FiscalPathShape | null {
  if (segments.length === 1 && segments[0] === "fiscal-documents")
    return method === "GET" ? "fiscalList" : "fiscalIssue";
  if (segments.length === 2 && segments[0] === "fiscal-documents" && method === "GET")
    return "fiscalItem";
  if (
    segments.length === 3 &&
    segments[0] === "fiscal-documents" &&
    segments[2] === "cancel" &&
    method === "POST"
  )
    return "fiscalCancel";
  return null;
}
function resolveFiscalQuery(
  params: URLSearchParams,
  shape: FiscalPathShape,
  method: FiscalMethod
): string | null {
  const keys = [...params.keys()];
  if (keys.length === 0) return "";
  if (method !== "GET" || keys.some((key) => !FISCAL_QUERY_KEYS[shape].includes(key))) return null;
  const forwarded = new URLSearchParams();
  for (const key of FISCAL_QUERY_KEYS[shape]) {
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
  const shape = fiscalPathShape(segments, method);
  if (shape === null) return { ok: false, response: notFound() };
  const query = resolveFiscalQuery(request.nextUrl.searchParams, shape, method);
  if (query === null) return { ok: false, response: notFound() };
  return { ok: true, path: `/${segments.map(encodeURIComponent).join("/")}${query}`, shape };
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
async function resolveFiscalBody(
  request: NextRequest,
  shape: FiscalPathShape,
  method: FiscalMethod
): Promise<{ ok: true; body: string | undefined } | { ok: false; response: NextResponse }> {
  const contract = FISCAL_BODY_CONTRACTS[shape];
  if (method !== "POST" || contract === undefined) return { ok: true, body: undefined };
  const text = await request.text();
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
  const bodyResolution = await resolveFiscalBody(request, resolution.shape, method);
  if (!bodyResolution.ok) return bodyResolution.response;
  const headers: Record<string, string> = { cookie: `${STAFF_SESSION_COOKIE}=${session.value}` };
  const requestId = request.headers.get("x-request-id");
  if (requestId) headers["x-request-id"] = requestId;
  if (bodyResolution.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL}${resolution.path}`,
    {
      method,
      headers,
      body: bodyResolution.body,
      cache: "no-store",
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
