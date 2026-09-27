"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listSuppliers } from "../suppliers/suppliers-api";
import { listCatalogItems } from "../catalog/catalog-api";
import type { PurchaseStatus } from "./purchases-api";

/**
 * Display identity for the purchase surface (EPIC-11 PUR-003).
 *
 * A purchase projection carries `supplierId` and `catalogItemId` values but no
 * names, and the purchase API deliberately exposes no name-resolution
 * endpoint. This module resolves those references through the EXISTING supplier
 * and catalog clients, read-only, and degrades gracefully: when a referenced
 * record is not readable by the caller — the supplier or catalog list answers
 * `403`, `404`, or the read fails outright — the surface shows a short id
 * fragment instead of failing the page or inventing a name.
 *
 * This is presentation only. No business rule, no authorization authority and
 * no new API surface is added here; the backend remains the authority and the
 * resolved name is a convenience the caller already has permission to read.
 */

/** A short, stable fragment of a UUID, shown when a display name is unreadable. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Staff-facing label for each lifecycle value. */
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: "Draft",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

/**
 * The API's `createdAt`/`updatedAt` are ISO timestamps; the surface shows the
 * stable UTC calendar date and performs no locale or arithmetic transformation.
 */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
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
 * Supplier display names, resolved from the read-only supplier list. A failed
 * read (including a `403` for a role that cannot list suppliers) resolves to an
 * empty map, so every reference degrades to its short id fragment.
 */
export function useSupplierNames(): DisplayNames {
  const query = useQuery({
    queryKey: ["suppliers", "display-names"],
    queryFn: () => listSuppliers(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => resolverFor(query.data), [query.data]);
}

/**
 * Catalog-item display names, resolved from the read-only catalog list. A
 * failed read resolves to an empty map, so every line degrades to its short id
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
