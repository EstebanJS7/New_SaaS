import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaleSearchInput } from "./sale-search-api";

export const SALE_LIST_CONTEXT_MS = 10 * 60 * 1000;
const key = ["sales", "list-context"] as const;
const defaults: SaleSearchInput = { q: "", page: 1, status: "all", sort: "recent" };
/** CONFIDENTIAL search context: same-document memory only, never dehydrate. */
export function useSalesListState() {
  const client = useQueryClient();
  // Keep context observed while the list is mounted; GC starts after leaving it.
  useQuery({ queryKey: key, queryFn: skipToken, gcTime: SALE_LIST_CONTEXT_MS });
  const [state, setState] = useState<SaleSearchInput>(() => {
    const saved = client.getQueryData<{ value: SaleSearchInput; expiresAt: number }>(key);
    return saved && saved.expiresAt > Date.now() ? saved.value : defaults;
  });
  useEffect(() => {
    client.setQueryDefaults(key, { gcTime: SALE_LIST_CONTEXT_MS });
    client.setQueryData(key, { value: state, expiresAt: Date.now() + SALE_LIST_CONTEXT_MS });
  }, [client, state]);
  return [state, setState] as const;
}
