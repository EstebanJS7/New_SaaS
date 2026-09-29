"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listCatalogItems } from "../catalog/catalog-api";
import { listCustomers } from "../customers/customers-api";
import { formatWireAmount, type PaymentMethod, type SaleStatus } from "./sales-api";

/**
 * Display identity for the POS surface (EPIC-12 POS-004).
 *
 * A sale line carries `catalogItemId` and a sale carries `customerId` but no
 * names, and the sale API exposes no name-resolution endpoint. This module
 * resolves those references through the EXISTING catalog and customer read
 * clients and degrades gracefully: when a referenced record is not readable —
 * the read answers `403`, `404` or fails outright — the surface shows a short id
 * fragment instead of failing the page or inventing a name.
 *
 * This is presentation only. No business rule, no authorization authority and no
 * new API surface is added here; the backend remains the authority and the
 * resolved name is a convenience the caller already has permission to read.
 */

/** A short, stable fragment of a UUID, shown when a display name is unreadable. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** The API's `createdAt`/`updatedAt` are ISO timestamps; show the UTC date only. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Staff-facing label for each pinned lifecycle value. */
export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  DRAFT: "Draft",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Staff-facing label for each pinned PRD §19 payment method. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  QR: "QR",
  CHECK: "Check",
  OTHER: "Other",
};

/**
 * Formats an exact wire amount with its currency. The amount is never parsed:
 * {@link formatWireAmount} groups the digits textually and this helper only
 * appends the sale's own currency field.
 */
export function formatAmount(value: string, currency: string): string {
  return `${formatWireAmount(value)} ${currency}`;
}

/** Resolves an id to a display name, falling back to a short id fragment. */
export interface DisplayNames {
  readonly nameFor: (id: string) => string;
}

function resolverFor(records: readonly { id: string; name: string }[] | undefined): DisplayNames {
  const map = new Map((records ?? []).map((record) => [record.id, record.name]));
  return { nameFor: (id: string) => map.get(id) ?? `#${shortId(id)}` };
}

/**
 * Catalog-item display names, resolved from the read-only catalog list. A failed
 * read resolves to an empty map, so every line degrades to its short id
 * fragment.
 */
export function useCatalogItemNames(): DisplayNames {
  const query = useQuery({
    queryKey: ["catalog", "display-names"],
    queryFn: () => listCatalogItems(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => resolverFor(query.data), [query.data]);
}

/**
 * Customer display names, resolved from the read-only customer list. The
 * selector is optional (DEC-028), so a failed read resolves to an empty map and
 * a walk-in sale continues unaffected.
 */
export function useCustomerNames(): DisplayNames {
  const query = useQuery({
    queryKey: ["customers", "display-names"],
    queryFn: () => listCustomers(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const records = useMemo(
    () => query.data?.map((customer) => ({ id: customer.id, name: customer.displayName })),
    [query.data]
  );
  return useMemo(() => resolverFor(records), [records]);
}
