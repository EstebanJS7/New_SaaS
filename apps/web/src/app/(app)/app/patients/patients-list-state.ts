import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PatientSearchInput } from "./patients-api";

export const PATIENT_LIST_CONTEXT_MS = 10 * 60 * 1000;
const key = ["patients", "list-context"] as const;
const defaults: PatientSearchInput = { q: "", page: 1, status: "active", sort: "name" };
/** CONFIDENTIAL search context: same-document memory only, never dehydrate. */
export function usePatientsListState() {
  const client = useQueryClient();
  // Keep context observed while the list is mounted; GC starts after leaving it.
  useQuery({ queryKey: key, queryFn: skipToken, gcTime: PATIENT_LIST_CONTEXT_MS });
  const [state, setState] = useState<PatientSearchInput>(() => {
    const saved = client.getQueryData<{ value: PatientSearchInput; expiresAt: number }>(key);
    return saved && saved.expiresAt > Date.now() ? saved.value : defaults;
  });
  useEffect(() => {
    client.setQueryDefaults(key, { gcTime: PATIENT_LIST_CONTEXT_MS });
    client.setQueryData(key, { value: state, expiresAt: Date.now() + PATIENT_LIST_CONTEXT_MS });
  }, [client, state]);
  return [state, setState] as const;
}
