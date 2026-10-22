import type { NextRequest, NextResponse } from "next/server";
import { proxyImportRequest } from "../imports-proxy";

export const dynamic = "force-dynamic";

/**
 * The staff imports BFF route ([[IMP-005]]).
 *
 * One catch-all covers `/api/imports` and every sub-path, because the resource
 * the surface reaches is ONE (an import job and its two commands). The closed
 * allowlist of `(method, path shape)` pairs lives in `../imports-proxy`, which is
 * where the reasoning belongs; this file is the transport wiring and nothing
 * else.
 *
 * `PUT`, `PATCH` and `DELETE` are not exported at all: the first two do not exist
 * on this surface and Next.js answers a method no handler exports with its own
 * `405`, which is the same status the explicit refusal in the proxy returns for a
 * known path reached with a wrong verb.
 */

interface ImportRouteContext {
  readonly params: Promise<{ readonly path?: string[] }>;
}

export async function GET(
  request: NextRequest,
  context: ImportRouteContext
): Promise<NextResponse> {
  const { path } = await context.params;
  return proxyImportRequest(request, "GET", path);
}

export async function POST(
  request: NextRequest,
  context: ImportRouteContext
): Promise<NextResponse> {
  const { path } = await context.params;
  return proxyImportRequest(request, "POST", path);
}
