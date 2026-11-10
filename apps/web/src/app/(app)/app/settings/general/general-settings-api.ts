"use client";

import type { SettingsNamespace } from "./general-settings-rules";

/**
 * Client for «Configuración › General» ([[CFG-001]]) through the allowlisted
 * `/api/settings/:namespace` proxy. `PUT` carries a partial patch: the API
 * merges it over the stored namespace and validates the result.
 */

export type SettingsData = Readonly<Record<string, unknown>>;

interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class SettingsApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SettingsApiError";
    this.code = code;
    this.status = status;
  }
}

async function request(namespace: SettingsNamespace, init?: RequestInit): Promise<SettingsData> {
  const response = await fetch(`/api/settings/${namespace}`, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
    throw new SettingsApiError(
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? `La solicitud falló (${response.status}).`,
      response.status
    );
  }
  const body = (await response.json()) as { settings?: unknown };
  if (typeof body.settings !== "object" || body.settings === null) {
    throw new SettingsApiError("UNKNOWN", "Respuesta inesperada de la API.", response.status);
  }
  return body.settings as SettingsData;
}

export function settingsQueryKey(namespace: SettingsNamespace): readonly string[] {
  return ["settings", namespace];
}

export function fetchSettings(namespace: SettingsNamespace): Promise<SettingsData> {
  return request(namespace);
}

export function updateSettings(
  namespace: SettingsNamespace,
  patch: Readonly<Record<string, unknown>>
): Promise<SettingsData> {
  return request(namespace, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/** A Spanish sentence per refusal; the API's English message is never shown (UX-036). */
export function settingsErrorMessage(error: unknown): {
  readonly message: string;
  readonly detail?: string;
} {
  if (!(error instanceof SettingsApiError)) {
    return { message: "No se pudieron guardar los cambios. Intentá de nuevo." };
  }
  switch (error.code) {
    case "VALIDATION_FAILED":
      return { message: "Los valores no son válidos. Revisalos e intentá de nuevo." };
    case "FORBIDDEN":
      return { message: "No tenés permiso para cambiar esta configuración." };
    case "FEATURE_NOT_ENTITLED":
      return { message: "Tu plan no incluye esta función." };
    default:
      return { message: "No se pudieron guardar los cambios. Intentá de nuevo." };
  }
}
