import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * The CLOSED set of exportable report codes.
 *
 * MIRROR of `REPORT_EXPORT_CODES` in
 * `apps/api/src/reporting/export/report-export.definitions.ts`, which owns the
 * list: the API is the authority on which reports exist, and this boundary
 * duplicates it only so an unknown code can be refused BEFORE an upstream call —
 * a proxy that forwarded anything would be a tunnel with a report-shaped hole in
 * it. Keep the two lists identical; a code added on one side only is a `400`
 * here and a `404` there.
 */
const REPORT_EXPORT_CODES = [
  "sales-by-period",
  "payment-methods",
  "sales-by-product-service",
  "cash-sessions",
  "cash-movements",
  "purchases",
  "stock",
  "low-stock",
  "consultations",
  "new-patients",
  "vaccines-due",
  "deworming-due",
] as const;

type ReportExportCode = (typeof REPORT_EXPORT_CODES)[number];

const REPORT_EXPORT_CODE_SET: ReadonlySet<string> = new Set<string>(REPORT_EXPORT_CODES);

function isReportExportCode(value: string): value is ReportExportCode {
  return REPORT_EXPORT_CODE_SET.has(value);
}

/**
 * Local refusal for a code outside the allowlist.
 *
 * `VALIDATION_FAILED` / `400` in the same envelope shape every proxy here uses,
 * and no upstream request is made: the caller learns its code is not exportable
 * without the API being asked about a report that does not exist. (The API
 * answers the same condition with its own `404` when it is reached directly; this
 * boundary refuses earlier because it CAN, having the same closed list.)
 */
function invalidReportCode(): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_FAILED", message: "Invalid report export code." } },
    { status: 400 }
  );
}

/**
 * Rejection for a request that carries no staff session. The private API answers
 * a missing session with this exact `401 UNAUTHENTICATED` envelope; this boundary
 * refuses it earlier only because there is no credential to forward.
 */
function unauthenticated(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "Authentication required." } },
    { status: 401 }
  );
}

/**
 * Proxies the staff CSV export to the private reporting API
 * (EPIC-18 REP-007, [[DEC-066]]).
 *
 * `/api/reports/:reportCode/export` maps to the upstream
 * `/reports/:reportCode/export`. The two things this boundary does NOT do are
 * deliberate:
 *
 * - **It does not interpret the query.** `?period=`, `?from=`/`?to=` and
 *   `?horizonDays=` are forwarded verbatim, because which of them a report
 *   accepts is the API's own per-report contract (`.strict()` schemas and the
 *   period/horizon rules). Re-validating them here would be a second opinion
 *   about a range, and the export is supposed to be the report with a different
 *   media type.
 * - **It does not synthesize a filename, a tenant or a permission.** Tenant and
 *   permission authority are resolved by the API from the forwarded session
 *   alone, and `Content-Disposition` is the API's — the browser would otherwise
 *   invent a name for the file.
 *
 * Browser headers cross through a strict allowlist: the staff session cookie
 * (read server-side by name, never the whole jar) and `x-request-id`. The
 * response is buffered as TEXT rather than streamed, because this endpoint's
 * payload is a UTF-8 text document whose `Content-Type` and `Content-Disposition`
 * must both survive — the same text-buffering shape the branding and customers
 * proxies use. A non-200 is forwarded with its status and the API's own JSON
 * error envelope, so a `403`, a `404` and every `400` reach the browser
 * unchanged.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportCode: string }> }
): Promise<NextResponse> {
  const { reportCode } = await params;
  if (!isReportExportCode(reportCode)) {
    return invalidReportCode();
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  // Only the staff cookie is consulted: a portal cookie cannot authenticate a
  // report export, and an empty value is no credential either.
  if (session === undefined || session.value.length === 0) {
    return unauthenticated();
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const headers: Record<string, string> = {
    cookie: `${STAFF_SESSION_COOKIE}=${session.value}`,
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  const query = request.nextUrl.searchParams.toString();
  const upstreamPath = `/reports/${encodeURIComponent(reportCode)}/export`;
  const response = await fetch(`${apiUrl}${upstreamPath}${query.length > 0 ? `?${query}` : ""}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };

  // Without this header the browser invents a filename, and the export's name —
  // the report code plus its resolved period — is part of the contract.
  const contentDisposition = response.headers.get("content-disposition");
  if (contentDisposition) {
    responseHeaders["content-disposition"] = contentDisposition;
  }

  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) {
    responseHeaders["x-request-id"] = responseRequestId;
  }

  // Buffered as text, not streamed: the payload is a text document of bounded
  // size (the API refuses anything over its row cap), and buffering is what keeps
  // the two headers above attached to a body the browser can save in one go.
  const responseBody = await response.text();
  return new NextResponse(responseBody, {
    status: response.status,
    headers: responseHeaders,
  });
}
