"use client";

/**
 * The portal's recovery REQUEST client ([[PORTAL-002]]).
 *
 * The tenant travels in the body because the API resolves the holder within it, and it comes from the
 * PATH: the visitor is already at `/[slug]/forgot-password`.
 */

interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

export async function requestPortalPasswordReset(tenantSlug: string, email: string): Promise<void> {
  const response = await fetch("/api/portal/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantSlug, email }),
    cache: "no-store",
  });
  if (response.ok) return;

  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  throw new ApiRequestError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `Request failed (${response.status})`,
    response.status
  );
}
