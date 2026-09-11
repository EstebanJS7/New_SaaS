import { describe, expect, it } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
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
