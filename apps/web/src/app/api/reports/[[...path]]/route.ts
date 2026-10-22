import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";
import {
  isAcceptedReportQueryKey,
  isReportCode,
  reportQueryKeysOf,
  type ReportCode,
} from "@/app/api/reports/report-codes";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * Resolves the browser path to the report code this boundary serves, or to the
 * rejection it answers instead.
 *
 * The shape is deliberately narrow: EXACTLY ONE segment, and that segment must be
 * one of the twelve codes (see `./report-codes`). Two consequences matter:
 *
 * - `[]` — `/api/reports` on its own — serves no report and is `404`.
 * - `["<code>", "export"]` is `404` too. That path belongs to the dedicated CSV
 *   proxy at `./[reportCode]/export/route.ts`, which Next.js resolves FIRST
 *   because a dynamic segment outranks a catch-all sibling and `export` is a
 *   static segment under it. The refusal here is therefore unreachable in normal
 *   routing and is exactly why it is written: if that precedence ever changed,
 *   this route would answer `404` rather than silently proxy a report read where
 *   a file download was asked for (the export needs `content-disposition`, which
 *   a JSON read answer must not carry).
 */
type ReportResolution =
  | { readonly ok: true; readonly code: ReportCode }
  | { readonly ok: false; readonly status: 400 | 404 };

function resolveReport(segments: readonly string[] | undefined): ReportResolution {
  const path = segments ?? [];
  if (path.length !== 1) {
    return { ok: false, status: 404 };
  }
  const code = path[0] ?? "";
  // A percent escape is never part of a legitimate code and would let an encoded
  // separator reshape the upstream URL, so it is refused with the unknown codes.
  if (code.includes("%") || !isReportCode(code)) {
    return { ok: false, status: 400 };
  }
  return { ok: true, code };
}

/**
 * Stable JSON rejection envelopes; no upstream call is made for a rejected
 * request, and the codes are the API's own so a caller can branch on them.
 *
 * - `400 VALIDATION_FAILED` — the code or a query key is outside the report's
 *   contract. The message is built from the report's OWN key list, so it never
 *   reflects caller input back.
 * - `404 NOT_FOUND` — the path is not a report read at all.
 */
function reportNotFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Report route not found." } },
    { status: 404 }
  );
}

function invalidReportCode(): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_FAILED", message: "Invalid report code." } },
    { status: 400 }
  );
}

function unsupportedQueryKey(code: ReportCode): NextResponse {
  const accepted = reportQueryKeysOf(code);
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_FAILED",
        message:
          accepted.length === 0
            ? // The API's own sentence for this case, so the two boundaries agree.
              "This report takes no query parameters."
            : `A report query accepts only: ${accepted.join(", ")}.`,
      },
    },
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
 * The staff reports read proxy ([[REP-008]], [[DEC-062]]).
 *
 * `/api/reports/<code>` maps to the upstream `/reports/<code>` for the twelve
 * codes the epic ships, GET only — the reporting surface is read-only, so there
 * is no command to proxy and no handler for one.
 *
 * The three things this boundary deliberately does NOT do:
 *
 * - **It does not interpret the query VALUES.** `?preset=` is forwarded as sent;
 *   which presets exist, what a `from`/`to` pair resolves to, the span bound and
 *   the horizon bound are the API's own contract ([[DEC-063]], [[DEC-065]]). A
 *   second opinion about a range here would be a second aggregation boundary.
 *   The KEYS are another matter and are allowlisted per report: an unknown key is
 *   refused locally instead of becoming a `400` that looks like a proxy defect.
 * - **It does not synthesize a tenant or a permission.** Both are resolved by the
 *   API from the forwarded session alone, which is why `?tenantId=` is refused
 *   rather than forwarded: tenant authority is never a request parameter.
 * - **It does not re-serialize the response.** The body is buffered as TEXT and
 *   re-emitted with the upstream status and `content-type`, so the API's own JSON
 *   — including every fixed-scale decimal string such as `"1234.50"` — reaches
 *   the browser byte for byte, and an error envelope arrives with its message
 *   intact for the workspace to render.
 *
 * Browser headers cross through a strict allowlist: the staff session cookie
 * (read server-side by name, never the whole jar) and `x-request-id`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const resolution = resolveReport(path);
  if (!resolution.ok) {
    return resolution.status === 404 ? reportNotFound() : invalidReportCode();
  }
  const code = resolution.code;

  // Refused BEFORE the credential is read and before any upstream call: the
  // caller learns which keys this report accepts without the API being asked.
  const searchParams = request.nextUrl.searchParams;
  for (const key of searchParams.keys()) {
    if (!isAcceptedReportQueryKey(code, key)) {
      return unsupportedQueryKey(code);
    }
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  // Only the staff cookie is consulted: a portal cookie cannot authenticate a
  // report read, and an empty value is no credential either.
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

  // Built from the ALLOWLISTED entries in the order the caller sent them: every
  // key has already been checked against this report's contract, so nothing can
  // reach the upstream URL that the report does not accept.
  const forwarded = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    forwarded.append(key, value);
  }
  const query = forwarded.toString();
  const upstreamPath = `/reports/${encodeURIComponent(code)}`;
  const response = await fetch(`${apiUrl}${upstreamPath}${query.length > 0 ? `?${query}` : ""}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };

  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) {
    responseHeaders["x-request-id"] = responseRequestId;
  }

  // Buffered as text, not streamed: the payload is a bounded JSON document, and
  // buffering is what keeps the status, the content-type and the exact bytes
  // together — a re-`json()` here would reorder keys and could round a decimal.
  const responseBody = await response.text();
  return new NextResponse(responseBody, {
    status: response.status,
    headers: responseHeaders,
  });
}
