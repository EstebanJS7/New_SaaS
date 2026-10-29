import { describe, expect, it } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { CSP_NONCE_HEADER } from "./lib/csp";
import { middleware, resolveTrustedTenantSlug } from "./middleware";

/**
 * Reads the `x-tenant-slug` value the middleware forwards to the server
 * component, or `null` when the middleware did not override it.
 *
 * Next encodes a forwarded request-header override as an entry in
 * `x-middleware-override-headers` plus an `x-middleware-request-<name>` value.
 * A header that is not listed keeps its incoming (client) value, so listing it
 * with an explicit value is what actually restricts provenance.
 */
function forwardedSlug(response: NextResponse): string | null {
  const overrides = response.headers.get("x-middleware-override-headers") ?? "";
  const names = overrides
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!names.includes("x-tenant-slug")) {
    return null;
  }
  return response.headers.get("x-middleware-request-x-tenant-slug");
}

function runMiddleware(pathname: string, incomingSlug?: string): NextResponse {
  const headers: Record<string, string> = {};
  if (incomingSlug !== undefined) {
    headers["x-tenant-slug"] = incomingSlug;
  }
  const request = new NextRequest(`http://localhost:3000${pathname}`, { headers });
  return middleware(request);
}

describe("middleware tenant-slug provenance", () => {
  it("resolves a portal first segment as the trusted slug", () => {
    expect(resolveTrustedTenantSlug("/acme-clinic")).toBe("acme-clinic");
    expect(resolveTrustedTenantSlug("/acme-clinic/services")).toBe("acme-clinic");
  });

  it("never resolves a slug for staff, root, reserved, or dotted paths", () => {
    expect(resolveTrustedTenantSlug("/app")).toBe("");
    // DAT-007 gave the app its first PUBLIC page, at a bare path -- which is the portal's
    // namespace. Reserving it is what keeps the route from squatting on a tenant's slug.
    expect(resolveTrustedTenantSlug("/reset-password")).toBe("");
    // SHEL-001's two public pages, for the same reason: an unreserved bare path is a tenant.
    expect(resolveTrustedTenantSlug("/login")).toBe("");
    expect(resolveTrustedTenantSlug("/forgot-password")).toBe("");
    expect(resolveTrustedTenantSlug("/app/settings/branding")).toBe("");
    expect(resolveTrustedTenantSlug("/")).toBe("");
    expect(resolveTrustedTenantSlug("/branding")).toBe("");
    expect(resolveTrustedTenantSlug("/api/v1/public/branding")).toBe("");
    expect(resolveTrustedTenantSlug("/favicon.ico")).toBe("");
  });

  it("strips a client-supplied slug on staff paths so root first paint cannot be influenced", () => {
    const response = runMiddleware("/app", "attacker-tenant");
    expect(forwardedSlug(response)).toBe("");
    expect(forwardedSlug(response)).not.toBe("attacker-tenant");
  });

  it("strips a client-supplied slug on the root path", () => {
    const response = runMiddleware("/", "attacker-tenant");
    expect(forwardedSlug(response)).toBe("");
  });

  it("overwrites a client-supplied slug with the real portal first segment", () => {
    const response = runMiddleware("/acme-clinic", "attacker-tenant");
    expect(forwardedSlug(response)).toBe("acme-clinic");
  });

  it("still tags portal paths that carry no client slug", () => {
    const response = runMiddleware("/acme-clinic");
    expect(forwardedSlug(response)).toBe("acme-clinic");
  });
});

/**
 * Reads a request-header override the middleware forwards to server components.
 * Same encoding `forwardedSlug` relies on: `x-middleware-override-headers` lists
 * the names, and each listed name has an `x-middleware-request-<name>` value.
 */
function forwardedHeader(response: NextResponse, name: string): string | null {
  const overrides = response.headers.get("x-middleware-override-headers") ?? "";
  const names = overrides
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!names.includes(name)) {
    return null;
  }
  return response.headers.get(`x-middleware-request-${name}`);
}

/** Pulls one directive's value out of a serialized policy string. */
function directive(policy: string, name: string): string | undefined {
  return policy
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name} `))
    ?.slice(name.length + 1);
}

describe("middleware Content-Security-Policy (HARD-001)", () => {
  it("emits a policy on the response and on the forwarded request", () => {
    const response = runMiddleware("/app");

    // The browser enforces the RESPONSE header; Next reads the REQUEST header to
    // apply the same nonce to its own hydration/streaming scripts. Both are needed.
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(forwardedHeader(response, "content-security-policy")).toContain("default-src 'self'");
  });

  it("authorizes the inline nodes with the exact nonce it forwards to the layouts", () => {
    const response = runMiddleware("/app");
    const policy = response.headers.get("content-security-policy") ?? "";
    const nonce = forwardedHeader(response, CSP_NONCE_HEADER);

    expect(nonce).toBeTruthy();
    // One value, two consumers: if these drift, every inline <script>/<style> is
    // blocked and the tenant loses its pre-paint brand.
    expect(directive(policy, "script-src")).toContain(`'nonce-${nonce}'`);
    expect(directive(policy, "style-src")).toContain(`'nonce-${nonce}'`);
  });

  it("mints a fresh nonce per request", () => {
    const first = forwardedHeader(runMiddleware("/app"), CSP_NONCE_HEADER);
    const second = forwardedHeader(runMiddleware("/app"), CSP_NONCE_HEADER);

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    // A reused nonce is a static secret an injected <script> could simply copy.
    expect(first).not.toBe(second);
  });

  it("never emits a policy that authorizes inline script or eval", () => {
    const policy = runMiddleware("/acme-clinic").headers.get("content-security-policy") ?? "";

    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
    expect(directive(policy, "frame-ancestors")).toBe("'none'");
    expect(directive(policy, "object-src")).toBe("'none'");
    expect(directive(policy, "base-uri")).toBe("'self'");
  });

  it("still applies the policy to portal tenant paths, not only staff paths", () => {
    const response = runMiddleware("/acme-clinic");

    expect(response.headers.get("content-security-policy")).toContain("script-src");
    expect(forwardedSlug(response)).toBe("acme-clinic");
  });
});

it("overwrites forged return context and strips non-context query values", () => {
  const request = new NextRequest("https://staff.invalid/app/agenda?notes=private", {
    headers: { "x-staff-return-path": "https://evil.test" },
  });
  expect(middleware(request).headers.get("x-middleware-request-x-staff-return-path")).toBe(
    "/app/agenda"
  );
});
