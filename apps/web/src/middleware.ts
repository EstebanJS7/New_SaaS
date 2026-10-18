import { NextResponse, type NextRequest } from "next/server";

/**
 * Portal tenant-slug edge resolution.
 *
 * The portal surface is `/[slug]`. The document root must know the tenant
 * before first paint so the tenant-aware appearance bootstrap can run ahead of
 * every paint-affecting node. Middleware tags portal path requests with an
 * `x-tenant-slug` request header, which the root layout reads server-side.
 *
 * Provenance is server-controlled: middleware ALWAYS overwrites the header, so
 * a client-supplied `x-tenant-slug` can never influence the root first paint of
 * staff or root documents. Non-portal paths receive an explicit empty value
 * (an absent client header is not enough — Next only propagates an override
 * when the header is explicitly present in the forwarded header set). The
 * header only carries the public slug used to fetch the anonymous branding DTO;
 * it is never treated as an authorization or tenant-authority signal. Staff
 * routes under `/app` resolve the tenant from the session cookie instead.
 */
/**
 * First segments that are the APP's rather than a tenant's.
 *
 * `reset-password` joined this list with DAT-007: the public recovery page is served at
 * that path, and without the reservation the middleware would read it as a portal slug,
 * tag the document with a tenant named "reset-password" and send the root layout looking
 * for that tenant's branding. The page would still render — the lookup fails closed to
 * the product preset — but the route would be quietly squatting on a namespace that
 * belongs to tenants.
 */
const RESERVED_FIRST_SEGMENTS = new Set(["app", "api", "branding", "reset-password", "_next"]);

/**
 * Returns the only tenant slug a request may carry.
 *
 * `""` means "no tenant signal" and is used for staff, root, API, and any
 * static/dotted path. Only a genuine portal first segment yields a value.
 */
export function resolveTrustedTenantSlug(pathname: string): string {
  const firstSegment = pathname.split("/")[1] ?? "";

  if (
    firstSegment.length === 0 ||
    RESERVED_FIRST_SEGMENTS.has(firstSegment) ||
    firstSegment.includes(".")
  ) {
    return "";
  }

  return firstSegment;
}

export function middleware(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-slug", resolveTrustedTenantSlug(request.nextUrl.pathname));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|branding).*)"],
};
