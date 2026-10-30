import { useEffect, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StudySearchInput } from "./study-search-api";
export const STUDY_LIST_CONTEXT_MS = 10 * 60 * 1000;
export const STUDY_DEFAULTS: StudySearchInput = {
  q: "",
  page: 1,
  period: "all",
  sort: "recent",
};
/** CONFIDENTIAL context scoped by patient in expiring document memory only. */
export function useStudyListState(patientId: string) {
  const client = useQueryClient();
  const key = ["clinical", patientId, "study-list-context"] as const;
  useQuery({ queryKey: key, queryFn: skipToken, gcTime: STUDY_LIST_CONTEXT_MS });
  const [state, setState] = useState<StudySearchInput>(() => {
    const saved = client.getQueryData<{ value: StudySearchInput; expiresAt: number }>(key);
    return saved && saved.expiresAt > Date.now() ? saved.value : STUDY_DEFAULTS;
  });
  useEffect(() => {
    const contextKey = ["clinical", patientId, "study-list-context"] as const;
    client.setQueryDefaults(contextKey, { gcTime: STUDY_LIST_CONTEXT_MS });
    client.setQueryData(contextKey, {
      value: state,
      expiresAt: Date.now() + STUDY_LIST_CONTEXT_MS,
    });
  }, [client, patientId, state]);
  return [state, setState] as const;
}
