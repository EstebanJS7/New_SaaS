"use client";
import { useEffect, useRef } from "react";
import { skipToken, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { TreatmentDetail } from "./treatment-search-api";
import type { StudyDetail } from "./study-search-api";
import type { WeightDetail } from "./weight-search-api";

export interface TreatmentFields {
  description: string;
  date: string;
  context: string;
}
export interface StudyFields {
  studyType: string;
  date: string;
  result: string;
}
export interface WeightFields {
  quantity: string;
  date: string;
  confirmedKg: boolean;
}
/** CONFIDENTIAL. Veterinary working copies only; never persist/dehydrate these keys. */
export type ClinicalRecordCopy =
  | { kind: "treatment"; initial?: TreatmentDetail; fields: TreatmentFields }
  | { kind: "study"; initial?: StudyDetail; fields: StudyFields }
  | { kind: "weight"; initial?: WeightDetail; fields: WeightFields };
export type ClinicalRecordKind = ClinicalRecordCopy["kind"];
export type ClinicalRecordRecovery = ClinicalRecordCopy & {
  token: string;
  status: "draft" | "pending" | "uncertain";
  expiresAt: number;
};
export const RECORD_RECOVERY_MS = 10 * 60 * 1000;
export const recordRecoveryKey = (patientId: string, kind: ClinicalRecordKind) =>
  ["clinical-record-recovery", patientId, kind] as const;

export function clearRecordRecovery(
  client: QueryClient,
  patientId: string,
  kind: ClinicalRecordKind,
  token?: string
) {
  const key = recordRecoveryKey(patientId, kind);
  const entry = client.getQueryData<ClinicalRecordRecovery>(key);
  if (token === undefined || entry?.token === token) client.setQueryData(key, null);
}
export function deniedClinicalRead(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}
function expiredSession(client: QueryClient): boolean {
  return client
    .getQueryCache()
    .getAll()
    .some(
      ({ state }) =>
        typeof state.error === "object" &&
        state.error !== null &&
        "status" in state.error &&
        state.error.status === 401
    );
}

/** One slot per patient/kind, scoped to the existing document's QueryClient. */
export function useRecordRecovery(patientId: string, kind: ClinicalRecordKind) {
  const client = useQueryClient();
  const query = useQuery<ClinicalRecordRecovery | null>({
    queryKey: recordRecoveryKey(patientId, kind),
    queryFn: skipToken,
    gcTime: RECORD_RECOVERY_MS,
    staleTime: Infinity,
  });
  const entry = query.data;
  useEffect(() => {
    if (!entry) return;
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) {
      clearRecordRecovery(client, patientId, kind, entry.token);
      return;
    }
    const timer = window.setTimeout(
      () => clearRecordRecovery(client, patientId, kind, entry.token),
      remaining
    );
    return () => window.clearTimeout(timer);
  }, [client, patientId, kind, entry]);
  return entry && entry.expiresAt > Date.now() ? entry : undefined;
}

/** Retain on unmount, never on the server; command settlement is generation-safe. */
export function useRetainRecordForm(patientId: string, copy: ClinicalRecordCopy, dirty: boolean) {
  const client = useQueryClient();
  const latest = useRef({ copy, dirty });
  latest.current = { copy, dirty };
  const token = useRef(crypto.randomUUID());
  const phase = useRef<ClinicalRecordRecovery["status"]>("draft");
  const finished = useRef(false);
  const mounted = useRef(true);
  const kind = copy.kind;
  useEffect(() => {
    mounted.current = true;
    clearRecordRecovery(client, patientId, kind);
    return () => {
      mounted.current = false;
      if (
        finished.current ||
        expiredSession(client) ||
        (!latest.current.dirty && phase.current === "draft")
      )
        return;
      const key = recordRecoveryKey(patientId, kind);
      client.setQueryDefaults(key, { gcTime: RECORD_RECOVERY_MS });
      client.setQueryData<ClinicalRecordRecovery>(key, {
        ...latest.current.copy,
        token: token.current,
        status: phase.current,
        expiresAt: Date.now() + RECORD_RECOVERY_MS,
      });
    };
  }, [client, patientId, kind]);
  function discard() {
    finished.current = true;
    // The recovered slot may belong to the previous mount, not this new token.
    clearRecordRecovery(client, patientId, kind);
  }
  function settled(error?: unknown) {
    if (deniedClinicalRead(error)) {
      finished.current = true;
      clearRecordRecovery(client, patientId, kind, mounted.current ? undefined : token.current);
      return;
    }
    phase.current =
      typeof error === "object" &&
      error !== null &&
      "uncertain" in error &&
      error.uncertain === true
        ? "uncertain"
        : "draft";
    const key = recordRecoveryKey(patientId, kind);
    const entry = client.getQueryData<ClinicalRecordRecovery>(key);
    if (entry?.token === token.current && !expiredSession(client))
      client.setQueryData(key, { ...entry, status: phase.current });
  }
  return {
    begin: () => {
      phase.current = "pending";
    },
    settled,
    discard,
    saved: () => {
      finished.current = true;
      clearRecordRecovery(client, patientId, kind, token.current);
      if (mounted.current) clearRecordRecovery(client, patientId, kind);
      void client.invalidateQueries({ queryKey: ["clinical", patientId, kind + "-search"] });
      void client.invalidateQueries({ queryKey: ["clinical", patientId, kind + "-detail"] });
      return mounted.current;
    },
  };
}
