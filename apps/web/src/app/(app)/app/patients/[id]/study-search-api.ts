export interface StudySearchInput {
  q: string;
  page: number;
  period: "all" | "last30";
  sort: "recent" | "oldest";
}
export interface StudySummary {
  id: string;
  studyType: string;
  performedAt: string;
}
export interface StudyDetail extends StudySummary {
  version?: number;
  result: string;
}
export interface StudySearchResult {
  items: StudySummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export class StudyReadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
  }
}
export function userFacingStudyError(error: Error): string {
  if (error instanceof StudyReadError) {
    if (error.status === 401) return "Iniciá sesión para consultar los estudios.";
    if (error.code === "FEATURE_NOT_ENTITLED")
      return "La atención veterinaria no está habilitada para esta organización.";
    if (error.status === 403) return "No tenés permiso para consultar los estudios.";
    if (error.status === 404) return "No encontramos el paciente o el estudio solicitado.";
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
    throw new StudyReadError(code, response.status);
  }
  return (await response.json()) as T;
}
/** Clinical text travels only in a POST body; IDs are encoded path segments. */
export function searchStudies(patientId: string, input: StudySearchInput, signal?: AbortSignal) {
  return read<StudySearchResult>(`/api/clinical/${encodeURIComponent(patientId)}/studies/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}
export function getStudy(patientId: string, id: string, signal?: AbortSignal) {
  return read<StudyDetail>(
    `/api/clinical/${encodeURIComponent(patientId)}/studies/${encodeURIComponent(id)}`,
    { method: "GET", signal }
  );
}
