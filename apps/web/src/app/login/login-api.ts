"use client";

/**
 * The sign-in client ([[SHEL-001]]).
 *
 * It talks to the public auth BFF, which relays the API's `Set-Cookie` back to the browser.
 * Nothing here reads, stores or inspects the session: the cookie is `HttpOnly` precisely so
 * that no client code can, and a client that TRIED would be a client that could leak one.
 */

export interface SignInInput {
  readonly email: string;
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

export async function signIn(input: SignInInput): Promise<void> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password }),
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
