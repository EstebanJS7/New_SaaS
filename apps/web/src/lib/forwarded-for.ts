/**
 * DEC-093 — the client address the BFF passes on to the API.
 *
 * In production the browser reaches this server only through Caddy, which
 * REPLACES any `X-Forwarded-For` the browser sent with the address it actually
 * saw (Caddy trusts no upstream proxy by default). The API trusts this server
 * and Caddy as proxies (`API_TRUSTED_PROXIES`), so forwarding the header lets the
 * login and password-recovery rate limits key on the real client instead of on
 * this container. Without it, every login would appear to come from one address.
 *
 * Only a plain list of IPv4/IPv6 addresses is forwarded; anything else is
 * dropped, so the header cannot carry arbitrary text upstream.
 */

const ADDRESS_LIST = /^[0-9A-Fa-f:.]+(\s*,\s*[0-9A-Fa-f:.]+)*$/;
const MAX_LENGTH = 256;

export function forwardedForHeader(headers: Headers | undefined): Record<string, string> {
  const value = headers?.get("x-forwarded-for")?.trim();
  if (value === undefined || value.length === 0 || value.length > MAX_LENGTH) return {};
  return ADDRESS_LIST.test(value) ? { "x-forwarded-for": value } : {};
}
