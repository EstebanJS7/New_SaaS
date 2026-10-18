"use client";

/**
 * The portal sign-in client ([[PORTAL-001]]).
 *
 * The tenant travels in the BODY, because that is the API's contract
 * (`{ tenantSlug, email, password }`), and it comes from the PATH: the visitor is already at
 * `/[slug]/login`, so a field asking which clinic they mean would only invite a typo that
 * produces "wrong tenant" — a distinction the API deliberately does not make.
 */

export interface PortalSignInInput {
  readonly tenantSlug: string;
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

export async function portalSignIn(input: PortalSignInInput): Promise<void> {
  const response = await fetch("/api/portal/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantSlug: input.tenantSlug,
      email: input.email,
      password: input.password,
    }),
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
