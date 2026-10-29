import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogSearchInput } from "./catalog-search-api";

export const CATALOG_LIST_CONTEXT_MS = 10 * 60 * 1000;
const key = ["catalog", "list-context"] as const;
const defaults: CatalogSearchInput = {
  q: "",
  page: 1,
  status: "active",
  kind: "all",
  sort: "name",
};
/** CONFIDENTIAL search context: same-document memory only, never dehydrate. */
export function useCatalogListState() {
  const client = useQueryClient();
  // Keep context observed while the list is mounted; GC starts after leaving it.
  useQuery({ queryKey: key, queryFn: skipToken, gcTime: CATALOG_LIST_CONTEXT_MS });
  const [state, setState] = useState<CatalogSearchInput>(() => {
    const saved = client.getQueryData<{ value: CatalogSearchInput; expiresAt: number }>(key);
    return saved && saved.expiresAt > Date.now() ? saved.value : defaults;
  });
  useEffect(() => {
    client.setQueryDefaults(key, { gcTime: CATALOG_LIST_CONTEXT_MS });
    client.setQueryData(key, { value: state, expiresAt: Date.now() + CATALOG_LIST_CONTEXT_MS });
  }, [client, state]);
  return [state, setState] as const;
}
