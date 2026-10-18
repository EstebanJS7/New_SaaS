"use client";

/**
 * The public recovery client ([[TD-048]]).
 *
 * It talks to the public BFF, so it sends no session and expects none. **The token is
 * never logged, never stored and never put in a URL it did not come from**: it arrives in
 * the query string, is POSTed in the body, and lives in memory for the length of one
 * request.
 */

export interface ResetPasswordInput {
  readonly token: string;
  readonly password: string;
}

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

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const response = await fetch("/api/auth/password-reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: input.token, password: input.password }),
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
