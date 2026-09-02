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

interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

async function parseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  return new Error(body.error?.message ?? `Request failed (${response.status})`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api/customers${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/customers${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/customers${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

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
