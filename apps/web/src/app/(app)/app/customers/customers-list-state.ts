import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomerSearchInput } from "./customer-search-api";

export const CUSTOMER_LIST_CONTEXT_MS = 10 * 60 * 1000;
const key = ["customers", "list-context"] as const;
const defaults: CustomerSearchInput = {
  q: "",
  page: 1,
  status: "active",
  kind: "all",
  sort: "name",
};
/** CONFIDENTIAL search context: same-document memory only, never dehydrate. */
export function useCustomersListState() {
  const client = useQueryClient();
  // Keep context observed while the list is mounted; GC starts after leaving it.
  useQuery({ queryKey: key, queryFn: skipToken, gcTime: CUSTOMER_LIST_CONTEXT_MS });
  const [state, setState] = useState<CustomerSearchInput>(() => {
    const saved = client.getQueryData<{ value: CustomerSearchInput; expiresAt: number }>(key);
    return saved && saved.expiresAt > Date.now() ? saved.value : defaults;
  });
  useEffect(() => {
    client.setQueryDefaults(key, { gcTime: CUSTOMER_LIST_CONTEXT_MS });
    client.setQueryData(key, { value: state, expiresAt: Date.now() + CUSTOMER_LIST_CONTEXT_MS });
  }, [client, state]);
  return [state, setState] as const;
}
