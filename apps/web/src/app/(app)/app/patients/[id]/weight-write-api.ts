import { getWeight, WeightReadError, type WeightDetail } from "./weight-search-api";
export interface WeightWriteInput {
  quantity: string;
  measuredAt: string;
  unit: "KG";
}
export class WeightWriteError extends WeightReadError {
  constructor(
    code: string,
    status: number,
    readonly uncertain = false
  ) {
    super(code, status);
  }
}
/** Preserve legacy command DTOs; re-read the unit-aware staff projection after commit. */
export async function writeWeight(
  patientId: string,
  id: string | undefined,
  input: Partial<WeightWriteInput>
): Promise<WeightDetail> {
  let response: Response;
  try {
    response = await fetch(
      `/api/clinical/${encodeURIComponent(patientId)}/weights${id === undefined ? "" : `/${encodeURIComponent(id)}`}`,
      {
        method: id === undefined ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
      }
    );
  } catch {
    throw new WeightWriteError("UNKNOWN_RESULT", 0, true);
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
    throw new WeightWriteError(
      code,
      response.status,
      response.status >= 500 || response.status === 408
    );
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("id" in payload) ||
    typeof payload.id !== "string"
  )
    throw new WeightWriteError("UNKNOWN_RESULT", response.status, true);
  try {
    const result = await getWeight(patientId, payload.id);
    if (
      result.id !== payload.id ||
      (result.unit !== null && result.unit !== "KG") ||
      typeof result.quantity !== "string" ||
      typeof result.measuredAt !== "string"
    )
      throw new Error("Invalid saved weight");
    return result;
  } catch {
    throw new WeightWriteError("UNKNOWN_RESULT", response.status, true);
  }
}
