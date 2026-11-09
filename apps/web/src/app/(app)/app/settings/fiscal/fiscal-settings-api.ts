"use client";

/**
 * Client for the fiscal settings screen (FISC-018, DEC-095 delivery 2) through the
 * allowlisted `/api/fiscal` proxy. The API decides `fiscal.profile.manage`, the
 * `fiscal` feature and every conflict; this module only carries them.
 */

export interface IssuancePoint {
  readonly establishmentId: string;
  readonly establishmentCode: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
}

export interface EmitterProfile {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  /** `null` while none is declared; the five fields travel together. */
  readonly responsibleIssuer: ResponsibleIssuerInput | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
  readonly activities: readonly { readonly code: string; readonly description: string }[];
  readonly issuancePoint: IssuancePoint | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResponsibleIssuerInput {
  readonly type: number;
  readonly typeName: string;
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export interface EmitterProfileInput {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly responsibleIssuer: ResponsibleIssuerInput | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
  readonly activities: readonly { readonly code: string; readonly description: string }[];
}

export interface Establishment {
  readonly id: string;
  readonly code: string;
  readonly addressLine: string;
  readonly houseNumber: number;
  readonly addressComplement1: string | null;
  readonly addressComplement2: string | null;
  readonly departmentCode: number;
  readonly districtCode: number | null;
  readonly districtName: string | null;
  readonly cityCode: number;
  readonly cityName: string;
  readonly phone: string;
  readonly email: string;
  readonly branchName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EstablishmentInput {
  readonly code: string;
  readonly addressLine: string;
  readonly houseNumber: number;
  readonly addressComplement1: string | null;
  readonly addressComplement2: string | null;
  readonly departmentCode: number;
  readonly district: { readonly code: number; readonly name: string } | null;
  readonly cityCode: number;
  readonly cityName: string;
  readonly phone: string;
  readonly email: string;
  readonly branchName: string | null;
}

export type TimbradoRangeStatus = "ACTIVE" | "VOIDING" | "RETIRED";

export interface TimbradoRange {
  readonly id: string;
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  readonly series: string | null;
  readonly timbradoNumber: string;
  readonly rangeFrom: number;
  readonly rangeTo: number;
  readonly validityStart: string;
  readonly nextNumber: number;
  readonly status: TimbradoRangeStatus;
}

export interface TimbradoRangeInput {
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  readonly series: string | null;
  readonly timbradoNumber: string;
  readonly rangeFrom: number;
  readonly rangeTo: number;
  readonly validityStart: string;
}

export interface IssuancePointInput {
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
}

export interface IssuancePointDeclaration {
  readonly issuancePoint: IssuancePoint;
  readonly creditNoteRangeActive: boolean;
}

interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class FiscalSettingsApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "FiscalSettingsApiError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response): Promise<FiscalSettingsApiError> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  return new FiscalSettingsApiError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `La solicitud falló (${response.status}).`,
    response.status
  );
}

export async function fiscalSettingsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/fiscal/${path}`, { cache: "no-store", ...init });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

function send<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> {
  return fiscalSettingsRequest<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The tenant's emitter profile, or `null` while it has none (the API's 404). */
export async function getEmitterProfile(): Promise<EmitterProfile | null> {
  try {
    return await fiscalSettingsRequest<EmitterProfile>("emitter-profile");
  } catch (error) {
    if (error instanceof FiscalSettingsApiError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export function saveEmitterProfile(input: EmitterProfileInput): Promise<EmitterProfile> {
  return send<EmitterProfile>("PUT", "emitter-profile", input);
}

export function declareIssuancePoint(input: IssuancePointInput): Promise<IssuancePointDeclaration> {
  return send<IssuancePointDeclaration>("PUT", "emitter-profile/issuance-point", input);
}

export async function listEstablishments(): Promise<Establishment[]> {
  return (await fiscalSettingsRequest<{ items: Establishment[] }>("establishments")).items;
}

export function createEstablishment(input: EstablishmentInput): Promise<Establishment> {
  return send<Establishment>("POST", "establishments", input);
}

export function updateEstablishment(id: string, input: EstablishmentInput): Promise<Establishment> {
  return send<Establishment>("PUT", `establishments/${id}`, input);
}

export async function listTimbradoRanges(): Promise<TimbradoRange[]> {
  return (await fiscalSettingsRequest<{ items: TimbradoRange[] }>("timbrado-ranges")).items;
}

export function createTimbradoRange(input: TimbradoRangeInput): Promise<TimbradoRange> {
  return send<TimbradoRange>("POST", "timbrado-ranges", input);
}

export function retireTimbradoRange(id: string, reason: string): Promise<TimbradoRange> {
  return send<TimbradoRange>("POST", `timbrado-ranges/${id}/retire`, { reason });
}

export function isFiscalPermissionDenied(error: unknown): boolean {
  return error instanceof FiscalSettingsApiError && error.code === "FORBIDDEN";
}

export function isFiscalFeatureMissing(error: unknown): boolean {
  return error instanceof FiscalSettingsApiError && error.code === "FEATURE_NOT_ENTITLED";
}

/**
 * A `409` carries the API's own sentence (the issuance point's "no hay un timbrado
 * activo…", "hay más de uno…"), shown as is. Every other refusal gets a fixed,
 * actionable Spanish sentence: the API's validation messages are not user copy.
 */
export function fiscalSettingsErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof FiscalSettingsApiError)) return fallback;
  switch (error.code) {
    case "CONFLICT":
      return error.message;
    case "VALIDATION_FAILED":
      return "Revisá los datos: algún campo no es válido.";
    case "FORBIDDEN":
      return "No tenés permiso para gestionar la configuración fiscal.";
    case "FEATURE_NOT_ENTITLED":
      return "La facturación electrónica no está habilitada para esta clínica.";
    case "NOT_FOUND":
      return "Ya no figura en la clínica. Actualizá la página.";
    default:
      return fallback;
  }
}
