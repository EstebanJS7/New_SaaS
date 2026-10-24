import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, createNonce, originOf, CSP_NONCE_HEADER } from "@/lib/csp";

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
const RESERVED_FIRST_SEGMENTS = new Set([
  "app",
  "api",
  "branding",
  "reset-password",
  // [[SHEL-001]]: the sign-in surface and its sibling, which are public pages rather than
  // portal tenants. The same near-miss TD-048 hit: an unreserved bare path is read as a
  // tenant slug, and the page would still render (the branding lookup fails closed to the
  // product preset) while quietly squatting on a namespace that belongs to tenants.
  "login",
  "forgot-password",
  "_next",
]);

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

  // Content-Security-Policy ([[DEC-075]] / [[HARD-001]]).
  //
  // One nonce per request, published on BOTH sides:
  // - request header `x-nonce`, which the layouts read to stamp every inline
  //   <script>/<style>;
  // - request AND response `content-security-policy`, because Next.js reads the
  //   policy off the request to apply the same nonce to its own hydration and
  //   streaming scripts, while the response header is what the browser enforces.
  const nonce = createNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    apiOrigin: originOf(process.env.NEXT_PUBLIC_API_URL),
    isDevelopment: process.env.NODE_ENV === "development",
  });
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|branding).*)"],
};
