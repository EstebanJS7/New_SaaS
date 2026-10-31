export interface WeightSearchInput {
  minQuantity?: string;
  maxQuantity?: string;
  unit?: "all" | "KG" | "unspecified";
  page: number;
  period: "all" | "last30";
  sort: "recent" | "oldest";
}
export interface WeightSummary {
  id: string;
  quantity: string;
  unit: "KG" | null;
  measuredAt: string;
}
export interface WeightDetail extends WeightSummary {
  version?: number;
}
export interface WeightSearchResult {
  items: WeightSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export class WeightReadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
  }
}
export function userFacingWeightError(error: Error): string {
  if (error instanceof WeightReadError) {
    if (error.status === 401) return "Iniciá sesión para consultar los pesos.";
    if (error.code === "FEATURE_NOT_ENTITLED")
      return "La atención veterinaria no está habilitada para esta organización.";
    if (error.status === 403) return "No tenés permiso para consultar los pesos.";
    if (error.status === 404) return "No encontramos el paciente o el registro de peso solicitado.";
    if (error.code === "VALIDATION_FAILED")
      return "Revisá la búsqueda y los filtros e intentá de nuevo.";
  }
  return "No pudimos completar la consulta. Revisá la conexión y volvé a intentar.";
}
async function read<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const error =
      typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "INTERNAL";
    throw new WeightReadError(code, response.status);
  }
  return (await response.json()) as T;
}
/** Clinical text travels only in a POST body; IDs are encoded path segments. */
export function searchWeights(patientId: string, input: WeightSearchInput, signal?: AbortSignal) {
  return read<WeightSearchResult>(`/api/clinical/${encodeURIComponent(patientId)}/weights/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}
export function getWeight(patientId: string, id: string, signal?: AbortSignal) {
  return read<WeightDetail>(
    `/api/clinical/${encodeURIComponent(patientId)}/weights/${encodeURIComponent(id)}`,
    { method: "GET", signal }
  );
}
