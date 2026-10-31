import { TreatmentReadError, type TreatmentDetail } from "./treatment-search-api";

import { acknowledgeServerDraft, type DurableDraftRef } from "./clinical-server-drafts-api";
export interface TreatmentWriteInput {
  draft?: DurableDraftRef;
  correctionReason?: string;
  description: string;
  administeredAt: string;
  context: string | null;
}
export class TreatmentWriteError extends TreatmentReadError {
  constructor(
    code: string,
    status: number,
    readonly uncertain = false
  ) {
    super(code, status);
  }
}
/** Owned staff commands require protection; no retries, replacement keys or caller tenant. */
export function writeTreatment(
  patientId: string,
  id: undefined,
  input: Partial<TreatmentWriteInput>,
  creation: { readonly key: string; savedId?: string }
): Promise<TreatmentDetail>;
export function writeTreatment(
  patientId: string,
  id: string,
  input: Partial<TreatmentWriteInput> & { expectedVersion: number; correctionReason: string }
): Promise<TreatmentDetail>;
export async function writeTreatment(
  patientId: string,
  id: string | undefined,
  input: Partial<TreatmentWriteInput> & { expectedVersion?: number },
  creation?: { key: string; savedId?: string }
): Promise<TreatmentDetail> {
  // Validate before network; never mint a replacement key or read a fresh version here.
  if (
    id === undefined
      ? typeof creation?.key !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(creation.key) ||
        input.expectedVersion !== undefined ||
        input.correctionReason !== undefined
      : creation !== undefined ||
        !Number.isInteger(input.expectedVersion) ||
        input.expectedVersion! < 1 ||
        input.expectedVersion! > 2147483647 ||
        typeof input.correctionReason !== "string" ||
        input.correctionReason.trim().length === 0 ||
        input.correctionReason.length > 2000
  )
    throw new TreatmentWriteError("INVALID_WRITE_GUARD", 0);
  let response: Response;
  const { draft, ...command } = input;
  if (
    draft &&
    (!/^[0-9a-f-]{36}$/i.test(draft.id) ||
      !Number.isInteger(draft.submitVersion) ||
      draft.submitVersion < 1)
  )
    throw new TreatmentWriteError("INVALID_WRITE_GUARD", 0);
  try {
    response = await fetch(
      draft
        ? `/api/clinical/${encodeURIComponent(patientId)}/drafts/${encodeURIComponent(draft.id)}/submit`
        : `/api/clinical/${encodeURIComponent(patientId)}/treatments${id === undefined ? "" : `/${encodeURIComponent(id)}`}`,
      {
        method: draft ? "POST" : id === undefined ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        // Strict older APIs reject this additive body key before writing.
        body: JSON.stringify(
          draft
            ? {
                version: draft.submitVersion,
                command: {
                  ...command,
                  ...(id === undefined && creation && { idempotencyKey: creation.key }),
                },
              }
            : {
                ...command,
                ...(id === undefined && creation && { idempotencyKey: creation.key }),
              }
        ),
        cache: "no-store",
      }
    );
  } catch {
    throw new TreatmentWriteError("UNKNOWN_RESULT", 0, true);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "INTERNAL";
    throw new TreatmentWriteError(
      code,
      response.status,
      response.status >= 500 || response.status === 408
    );
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("id" in payload) ||
    typeof payload.id !== "string" ||
    !("description" in payload) ||
    typeof payload.description !== "string" ||
    !("administeredAt" in payload) ||
    typeof payload.administeredAt !== "string" ||
    !("context" in payload) ||
    (payload.context !== null && typeof payload.context !== "string")
  )
    throw new TreatmentWriteError("UNKNOWN_RESULT", response.status, true);
  await acknowledgeServerDraft(patientId, draft);
  return {
    id: payload.id,
    description: payload.description,
    administeredAt: payload.administeredAt,
    context: payload.context,
  };
}
