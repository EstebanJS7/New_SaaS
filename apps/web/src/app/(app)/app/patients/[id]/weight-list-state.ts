import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WeightSearchInput } from "./weight-search-api";
export const WEIGHT_LIST_CONTEXT_MS = 10 * 60 * 1000;
export const WEIGHT_DEFAULTS: WeightSearchInput = {
  page: 1,
  period: "all",
  sort: "recent",
  unit: "all",
};
/** CONFIDENTIAL context scoped by patient in expiring document memory only. */
export function useWeightListState(patientId: string) {
  const client = useQueryClient();
  const key = ["clinical", patientId, "weight-list-context"] as const;
  useQuery({ queryKey: key, queryFn: skipToken, gcTime: WEIGHT_LIST_CONTEXT_MS });
  const [state, setState] = useState<WeightSearchInput>(() => {
    const saved = client.getQueryData<{ value: WeightSearchInput; expiresAt: number }>(key);
    return saved && saved.expiresAt > Date.now()
      ? {
          ...saved.value,
          unit:
            saved.value.unit ??
            (saved.value.minQuantity !== undefined || saved.value.maxQuantity !== undefined
              ? "unspecified"
              : "all"),
        }
      : WEIGHT_DEFAULTS;
  });
  useEffect(() => {
    const contextKey = ["clinical", patientId, "weight-list-context"] as const;
    client.setQueryDefaults(contextKey, { gcTime: WEIGHT_LIST_CONTEXT_MS });
    client.setQueryData(contextKey, {
      value: state,
      expiresAt: Date.now() + WEIGHT_LIST_CONTEXT_MS,
    });
  }, [client, patientId, state]);
  return [state, setState] as const;
}
