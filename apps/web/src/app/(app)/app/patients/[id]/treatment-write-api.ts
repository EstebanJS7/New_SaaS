import { TreatmentReadError, type TreatmentDetail } from "./treatment-search-api";

export interface TreatmentWriteInput {
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
/** Existing commands; no retries or caller tenant. A lost response may follow a commit. */
export async function writeTreatment(
  patientId: string,
  id: string | undefined,
  input: Partial<TreatmentWriteInput>
): Promise<TreatmentDetail> {
  let response: Response;
  try {
    response = await fetch(
      `/api/clinical/${encodeURIComponent(patientId)}/treatments${id === undefined ? "" : `/${encodeURIComponent(id)}`}`,
      {
        method: id === undefined ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
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
  return {
    id: payload.id,
    description: payload.description,
    administeredAt: payload.administeredAt,
    context: payload.context,
  };
}
