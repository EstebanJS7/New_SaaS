/**
 * Content-Security-Policy construction ([[DEC-075]], [[HARD-001]]).
 *
 * PRD §29 requires a CSP. `prd` asks for the control, not for a specific string,
 * and the string cannot be fixed in advance here: the web app legitimately needs
 * inline code and inline styles.
 *
 * ```text
 * apps/web/src/app/layout.tsx              inline <script> pre-paint appearance bootstrap
 *                                          inline <style>  product brand preset variables
 * apps/web/src/app/(app)/layout.tsx        the same pair, tenant overrides
 * apps/web/src/app/(portal)/layout.tsx     the same pair, portal surface
 * ```
 *
 * Those `<style>` nodes carry the resolved brand under `:root:not(.dark)` and are
 * emitted BEFORE any paint-affecting node so a tenant never sees a flash of the
 * wrong brand; `apps/web/src/app/layout.test.tsx` pins that ordering. A policy of
 * `style-src 'self'` blocks them and the tenant loses its brand on first paint.
 *
 * Hence the nonce: one value per request, published on the request so server
 * components can stamp every inline node, and on the response as the policy that
 * authorizes exactly those nodes. Next.js reads the policy from the request
 * header and applies the same nonce to its own hydration/streaming scripts, which
 * is why the header is set on BOTH the request and the response.
 *
 * This module is pure on purpose: `apps/web/src/middleware.ts` imports it, and
 * middleware cannot import `next/headers`. The server-side reader lives in
 * `./csp-nonce.ts`.
 */

/** Request header carrying the per-request nonce to server components. */
export const CSP_NONCE_HEADER = "x-nonce";

export interface BuildContentSecurityPolicyOptions {
  /** Per-request nonce. Must be unique per request; reuse defeats the control. */
  readonly nonce: string;
  /**
   * Origin of the API, e.g. `http://localhost:3001`.
   *
   * Needed because the PORTAL renders branding logos as ABSOLUTE URLs to the API
   * (`branding-asset-delivery.service.ts` builds `${publicBaseUrl}/api/v1/public/branding/assets/...`
   * for the public audience), while the staff shell renders same-origin relative
   * ones. Both must be allowed or the portal silently loses its logo.
   */
  readonly apiOrigin?: string;
  /**
   * Development only: Next's dev server evaluates code for HMR, which a strict
   * `script-src` blocks. Enabling eval in production would be a real weakening,
   * so this is gated on the build mode and asserted by a test.
   */
  readonly isDevelopment?: boolean;
}

/** Directives in a stable order, so the serialized policy is diffable. */
const DIRECTIVE_ORDER = [
  "default-src",
  "base-uri",
  "object-src",
  "frame-ancestors",
  "form-action",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
] as const;

/**
 * Captures the origin of an absolute URL, or `undefined` when the value is not a
 * usable absolute URL. A malformed configuration must not silently widen the
 * policy with a garbage token, so it degrades to "no extra origin".
 */
export function originOf(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Builds the policy for one request.
 *
 * `'unsafe-inline'` appears nowhere and `'unsafe-eval'` only under
 * `isDevelopment`. `'strict-dynamic'` is deliberately absent: nothing here loads
 * a script from another script, and enabling it would make `'self'` inert for
 * `script-src` — a change that should require its own decision rather than ride
 * along with this one.
 */
export function buildContentSecurityPolicy(options: BuildContentSecurityPolicyOptions): string {
  const { nonce, apiOrigin, isDevelopment = false } = options;

  if (nonce.trim().length === 0) {
    // Fail loud rather than emit a policy whose nonce authorizes nothing.
    throw new Error("buildContentSecurityPolicy requires a non-empty nonce");
  }

  const scriptSrc = ["'self'", `'nonce-${nonce}'`];
  if (isDevelopment) {
    scriptSrc.push("'unsafe-eval'");
  }

  const imgSrc = ["'self'", "data:", "blob:"];
  if (apiOrigin !== undefined) {
    imgSrc.push(apiOrigin);
  }

  const directives: Record<(typeof DIRECTIVE_ORDER)[number], readonly string[]> = {
    "default-src": ["'self'"],
    // No <base> rewriting: closes base-tag hijacking of every relative URL.
    "base-uri": ["'self'"],
    // No plugin content: nothing here embeds Flash-era objects.
    "object-src": ["'none'"],
    // Clickjacking: the staff and portal surfaces must never be framed.
    "frame-ancestors": ["'none'"],
    // Forms post to same-origin BFF proxies only.
    "form-action": ["'self'"],
    "script-src": scriptSrc,
    "style-src": ["'self'", `'nonce-${nonce}'`],
    "img-src": imgSrc,
    "font-src": ["'self'"],
    // Every browser fetch goes through a same-origin Next route handler; the API
    // origin is never called directly from the browser (checked: no client
    // component reads NEXT_PUBLIC_API_URL).
    "connect-src": ["'self'"],
  };

  return DIRECTIVE_ORDER.map((name) => `${name} ${directives[name].join(" ")}`).join("; ");
}

/**
 * Creates a per-request nonce.
 *
 * `crypto.randomUUID()` is available in both the Node and Edge runtimes Next uses
 * for middleware, and hyphens are legal in a CSP nonce's base64-value grammar.
 * No new dependency.
 */
export function createNonce(): string {
  return crypto.randomUUID();
}
