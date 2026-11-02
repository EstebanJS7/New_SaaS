"use client";

export interface Customer {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: "INDIVIDUAL" | "COMPANY";
  readonly displayName: string;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly documentNumber: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomerAddress {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly label: string | null;
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomerContact {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly kind: "EMAIL" | "PHONE";
  readonly label: string | null;
  readonly value: string;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Stable, sanitized errors: never expose server payloads containing personal data. */
export class CustomerRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly uncertain = false
  ) {
    super(customerErrorMessage(code, uncertain));
  }
}
function customerErrorMessage(code: string, uncertain: boolean): string {
  if (uncertain)
    return "No pudimos confirmar el resultado. Revisá el registro antes de repetir la operación; no volveremos a enviarla automáticamente.";
  switch (code) {
    case "UNAUTHENTICATED":
      return "Tu sesión terminó. Volvé a ingresar para continuar.";
    case "FORBIDDEN":
      return "No tenés permiso para realizar esta acción sobre clientes.";
    case "NOT_FOUND":
      return "No encontramos este registro de cliente.";
    case "VALIDATION_FAILED":
      return "Revisá los campos indicados y sus límites antes de guardar.";
    case "CONFLICT":
      return "El registro no admite este cambio. Revisá su estado actual antes de continuar.";
    default:
      return "No pudimos completar la solicitud. Revisá la conexión y volvé a intentar.";
  }
}
export function customerError(error: unknown): string {
  return error instanceof CustomerRequestError
    ? error.message
    : customerErrorMessage("UNKNOWN", false);
}
export function customerWriteBlocked(error: unknown): boolean {
  return (
    error instanceof CustomerRequestError &&
    (error.uncertain || [401, 403, 404].includes(error.status))
  );
}
async function request<T>(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown
): Promise<T> {
  const mutation = method !== "GET";
  let response: Response;
  try {
    response = await fetch(`/api/customers${path}`, {
      ...(mutation && {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      cache: "no-store",
    });
  } catch {
    throw new CustomerRequestError("NETWORK_ERROR", 0, mutation);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope =
      typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
    const code =
      typeof envelope === "object" &&
      envelope !== null &&
      "code" in envelope &&
      typeof envelope.code === "string"
        ? envelope.code
        : ((
            {
              401: "UNAUTHENTICATED",
              403: "FORBIDDEN",
              404: "NOT_FOUND",
              400: "VALIDATION_FAILED",
            } as Record<number, string>
          )[response.status] ?? "UNKNOWN");
    throw new CustomerRequestError(
      code,
      response.status,
      mutation && (response.status >= 500 || response.status === 408)
    );
  }
  // Validate the minimal acknowledgement before allowing UI to discard a draft.
  if (
    payload === null ||
    typeof payload !== "object" ||
    (mutation && (!("id" in payload) || typeof payload.id !== "string"))
  )
    throw new CustomerRequestError("MALFORMED_RESPONSE", response.status, mutation);
  return payload as T;
}
const getJson = <T>(path: string) => request<T>(path, "GET");
const postJson = <T>(path: string, body: unknown) => request<T>(path, "POST", body);
const putJson = <T>(path: string, body: unknown) => request<T>(path, "PUT", body);

export function listCustomers(): Promise<Customer[]> {
  return getJson("");
}

export function getCustomer(id: string): Promise<Customer> {
  return getJson(`/${id}`);
}

export function createCustomer(body: unknown): Promise<Customer> {
  return postJson("", body);
}

export function updateCustomer(id: string, body: unknown): Promise<Customer> {
  return putJson(`/${id}`, body);
}

export function deactivateCustomer(id: string): Promise<Customer> {
  return postJson(`/${id}/deactivate`, {});
}

export function listAddresses(customerId: string): Promise<CustomerAddress[]> {
  return getJson(`/${customerId}/addresses`);
}

export function createAddress(customerId: string, body: unknown): Promise<CustomerAddress> {
  return postJson(`/${customerId}/addresses`, body);
}

export function updateAddress(
  customerId: string,
  id: string,
  body: unknown
): Promise<CustomerAddress> {
  return putJson(`/${customerId}/addresses/${id}`, body);
}

export function deactivateAddress(customerId: string, id: string): Promise<CustomerAddress> {
  return postJson(`/${customerId}/addresses/${id}/deactivate`, {});
}

export function listContacts(customerId: string): Promise<CustomerContact[]> {
  return getJson(`/${customerId}/contacts`);
}

export function createContact(customerId: string, body: unknown): Promise<CustomerContact> {
  return postJson(`/${customerId}/contacts`, body);
}

export function updateContact(
  customerId: string,
  id: string,
  body: unknown
): Promise<CustomerContact> {
  return putJson(`/${customerId}/contacts/${id}`, body);
}

export function deactivateContact(customerId: string, id: string): Promise<CustomerContact> {
  return postJson(`/${customerId}/contacts/${id}/deactivate`, {});
}
