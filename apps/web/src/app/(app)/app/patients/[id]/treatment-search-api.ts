export interface TreatmentSearchInput {
  q: string;
  page: number;
  period: "all" | "last30";
  sort: "recent" | "oldest";
}
export interface TreatmentSummary {
  id: string;
  description: string;
  administeredAt: string;
}
export interface TreatmentDetail extends TreatmentSummary {
  version?: number;
  context: string | null;
}
export interface TreatmentSearchResult {
  items: TreatmentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export class TreatmentReadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
  }
}
export function userFacingTreatmentError(error: Error): string {
  if (error instanceof TreatmentReadError) {
    if (error.status === 401) return "Iniciá sesión para consultar los tratamientos.";
    if (error.code === "FEATURE_NOT_ENTITLED")
      return "La atención veterinaria no está habilitada para esta organización.";
    if (error.status === 403) return "No tenés permiso para consultar los tratamientos.";
    if (error.status === 404) return "No encontramos el paciente o el tratamiento solicitado.";
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
    throw new TreatmentReadError(code, response.status);
  }
  return (await response.json()) as T;
}
/** Clinical text travels only in a POST body; IDs are encoded path segments. */
export function searchTreatments(
  patientId: string,
  input: TreatmentSearchInput,
  signal?: AbortSignal
) {
  return read<TreatmentSearchResult>(
    `/api/clinical/${encodeURIComponent(patientId)}/treatments/search`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    }
  );
}
export function getTreatment(patientId: string, id: string, signal?: AbortSignal) {
  return read<TreatmentDetail>(
    `/api/clinical/${encodeURIComponent(patientId)}/treatments/${encodeURIComponent(id)}`,
    { method: "GET", signal }
  );
}
