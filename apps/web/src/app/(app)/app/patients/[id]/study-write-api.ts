import { StudyReadError, type StudyDetail } from "./study-search-api";

export interface StudyWriteInput {
  studyType: string;
  performedAt: string;
  result: string;
}
export class StudyWriteError extends StudyReadError {
  constructor(
    code: string,
    status: number,
    readonly uncertain = false
  ) {
    super(code, status);
  }
}
/** Existing commands; no retries or caller tenant. A lost response may follow a commit. */
export async function writeStudy(
  patientId: string,
  id: string | undefined,
  input: Partial<StudyWriteInput>
): Promise<StudyDetail> {
  let response: Response;
  try {
    response = await fetch(
      `/api/clinical/${encodeURIComponent(patientId)}/studies${id === undefined ? "" : `/${encodeURIComponent(id)}`}`,
      {
        method: id === undefined ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
      }
    );
  } catch {
    throw new StudyWriteError("UNKNOWN_RESULT", 0, true);
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
    throw new StudyWriteError(
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
    !("studyType" in payload) ||
    typeof payload.studyType !== "string" ||
    !("performedAt" in payload) ||
    typeof payload.performedAt !== "string" ||
    !("result" in payload) ||
    typeof payload.result !== "string"
  )
    throw new StudyWriteError("UNKNOWN_RESULT", response.status, true);
  return {
    id: payload.id,
    studyType: payload.studyType,
    performedAt: payload.performedAt,
    result: payload.result,
  };
}
