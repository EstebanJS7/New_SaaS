import type { QueryClient } from "@tanstack/react-query";
import type { ClinicalEncounterContent } from "./clinical-api";

/** CONFIDENTIAL, same-document memory only. Never dehydrate or persist this key. */
export interface RecoveredClinicalDraft {
  encounterId: string;
  version: number;
  baseline: ClinicalEncounterContent;
  content: ClinicalEncounterContent;
  expiresAt: number;
}

export const CLINICAL_RECOVERY_MS = 10 * 60 * 1000;
const key = (patientId: string) => ["clinical-draft-recovery", patientId] as const;

export function clearClinicalRecovery(client: QueryClient, patientId: string): void {
  client.removeQueries({ queryKey: key(patientId), exact: true });
}

export function readClinicalRecovery(
  client: QueryClient,
  patientId: string
): RecoveredClinicalDraft | undefined {
  const draft = client.getQueryData<RecoveredClinicalDraft>(key(patientId));
  if (draft && draft.expiresAt <= Date.now()) {
    clearClinicalRecovery(client, patientId);
    return undefined;
  }
  return draft;
}

export function retainClinicalRecovery(
  client: QueryClient,
  patientId: string,
  draft: Omit<RecoveredClinicalDraft, "expiresAt">
): void {
  client.setQueryDefaults(key(patientId), { gcTime: CLINICAL_RECOVERY_MS });
  client.setQueryData<RecoveredClinicalDraft>(key(patientId), {
    ...draft,
    baseline: { ...draft.baseline },
    content: { ...draft.content },
    expiresAt: Date.now() + CLINICAL_RECOVERY_MS,
  });
}
