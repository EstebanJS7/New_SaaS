"use client";

/**
 * The portal's reset client ([[PORTAL-002]]).
 *
 * No tenant slug: the TOKEN is the authority, and it names its own access. The plaintext token lives
 * in memory for the length of one request — never logged, never stored, never put in a URL it did not
 * arrive in.
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

export async function resetPortalPassword(token: string, password: string): Promise<void> {
  const response = await fetch("/api/portal/password-reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password }),
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
