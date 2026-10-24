import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, createNonce, originOf } from "./csp";

const NONCE = "b9f0c1de-2a3b-4c5d-8e9f-0123456789ab";

/**
 * The policy is asserted VERBATIM ([[DEC-075]]).
 *
 * A weakened directive — an added `unsafe-inline`, a dropped `frame-ancestors` —
 * is invisible in review and fatal to the control, so the failure mode that
 * matters is caught by an exact string rather than by a relaxed shape check.
 */
describe("buildContentSecurityPolicy", () => {
  it("emits the exact production policy for a given nonce and API origin", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, apiOrigin: "http://localhost:3001" });

    expect(policy).toBe(
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        `script-src 'self' 'nonce-${NONCE}'`,
        `style-src 'self' 'nonce-${NONCE}'`,
        "img-src 'self' data: blob: http://localhost:3001",
        "font-src 'self'",
        "connect-src 'self'",
      ].join("; ")
    );
  });

  it("never authorizes inline script or inline style", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, isDevelopment: false });

    // The whole point of the nonce: a policy that permits 'unsafe-inline' lets an
    // injected <script> run, which is the attack this control exists to stop.
    expect(policy).not.toContain("unsafe-inline");
  });

  it("never authorizes eval in production", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, isDevelopment: false });

    expect(policy).not.toContain("unsafe-eval");
  });

  it("authorizes eval only in development, where Next's dev server needs it", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, isDevelopment: true });

    expect(policy).toContain(`script-src 'self' 'nonce-${NONCE}' 'unsafe-eval'`);
    // Even in development, styles stay nonce-only: Next does not eval CSS.
    expect(policy).toContain(`style-src 'self' 'nonce-${NONCE}'`);
  });

  it("omits the API origin from img-src when none is configured", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE });

    expect(policy).toContain("img-src 'self' data: blob:");
  });

  it("throws rather than emit a policy whose nonce authorizes nothing", () => {
    expect(() => buildContentSecurityPolicy({ nonce: "   " })).toThrow(/non-empty nonce/);
  });

  it("is stable across calls with the same inputs, so the string is diffable", () => {
    const first = buildContentSecurityPolicy({ nonce: NONCE, apiOrigin: "https://api.test" });
    const second = buildContentSecurityPolicy({ nonce: NONCE, apiOrigin: "https://api.test" });

    expect(first).toBe(second);
  });
});

describe("originOf", () => {
  it("captures the origin of an absolute URL", () => {
    expect(originOf("https://api.newsaas.test:8443/base/path")).toBe(
      "https://api.newsaas.test:8443"
    );
  });

  it("returns undefined for an absent, blank or malformed value", () => {
    // A malformed configuration must not widen the policy with a garbage token.
    expect(originOf(undefined)).toBeUndefined();
    expect(originOf("")).toBeUndefined();
    expect(originOf("   ")).toBeUndefined();
    expect(originOf("not a url")).toBeUndefined();
  });
});

describe("createNonce", () => {
  it("produces a distinct value per call", () => {
    const nonces = new Set(Array.from({ length: 64 }, () => createNonce()));

    expect(nonces.size).toBe(64);
  });

  it("produces a value that is safe inside the policy's nonce grammar", () => {
    // base64-value grammar: no quotes, no semicolons, no whitespace. A nonce that
    // contains one of those would terminate the directive early.
    const nonce = createNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/=_-]+$/);
    expect(nonce.length).toBeGreaterThanOrEqual(16);
  });
});
