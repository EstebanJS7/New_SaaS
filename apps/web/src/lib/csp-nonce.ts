import { headers } from "next/headers";
import { CSP_NONCE_HEADER } from "./csp";

/**
 * Reads the per-request CSP nonce for a server component ([[DEC-075]] / [[HARD-001]]).
 *
 * The value is minted once in `apps/web/src/middleware.ts` and published on the
 * request, so every inline `<script>`/`<style>` in a layout can stamp the same
 * nonce the response's policy declares. One source, no drift.
 *
 * Reading request headers makes the calling route dynamically rendered. That is
 * already true of all three layouts that use it — the root layout awaits
 * `headers()` for the tenant slug, the staff shell forwards the session cookie,
 * and the portal layout resolves the slug — so nothing that was static becomes
 * dynamic because of this call.
 *
 * Returns `undefined` in two cases, both benign and both non-throwing:
 *
 * - the request carries no nonce (a render outside a request scope, such as a
 *   unit test that renders a layout directly);
 * - there is no request scope at all, in which case `headers()` throws.
 *
 * `undefined` makes React omit the attribute rather than emit `nonce=""`. The
 * catch follows the same shape as `fetchResolvedBrand` in the staff shell: a
 * layout helper degrades instead of failing the render, because a missing nonce
 * costs the branding script and never the page.
 */
export async function readCspNonce(): Promise<string | undefined> {
  try {
    const headerStore = await headers();
    const nonce = headerStore.get(CSP_NONCE_HEADER);
    return nonce !== null && nonce.length > 0 ? nonce : undefined;
  } catch {
    return undefined;
  }
}
