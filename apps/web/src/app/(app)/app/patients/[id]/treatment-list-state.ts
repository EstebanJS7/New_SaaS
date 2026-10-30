import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TreatmentSearchInput } from "./treatment-search-api";
export const TREATMENT_LIST_CONTEXT_MS = 10 * 60 * 1000;
export const TREATMENT_DEFAULTS: TreatmentSearchInput = {
  q: "",
  page: 1,
  period: "all",
  sort: "recent",
};
/** CONFIDENTIAL context scoped by patient in expiring document memory only. */
export function useTreatmentListState(patientId: string) {
  const client = useQueryClient();
  const key = ["clinical", patientId, "treatment-list-context"] as const;
  useQuery({ queryKey: key, queryFn: skipToken, gcTime: TREATMENT_LIST_CONTEXT_MS });
  const [state, setState] = useState<TreatmentSearchInput>(() => {
    const saved = client.getQueryData<{ value: TreatmentSearchInput; expiresAt: number }>(key);
    return saved && saved.expiresAt > Date.now() ? saved.value : TREATMENT_DEFAULTS;
  });
  useEffect(() => {
    const contextKey = ["clinical", patientId, "treatment-list-context"] as const;
    client.setQueryDefaults(contextKey, { gcTime: TREATMENT_LIST_CONTEXT_MS });
    client.setQueryData(contextKey, {
      value: state,
      expiresAt: Date.now() + TREATMENT_LIST_CONTEXT_MS,
    });
  }, [client, patientId, state]);
  return [state, setState] as const;
}
