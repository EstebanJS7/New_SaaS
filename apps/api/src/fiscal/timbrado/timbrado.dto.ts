import type {
  EmitterProfileView,
  EstablishmentView,
  FiscalRangeVoidView,
  TimbradoRangeView,
} from "./timbrado.service.js";

export interface EmitterProfileResponse {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
  readonly activities: { code: string; description: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EstablishmentResponse {
  readonly id: string;
  readonly code: string;
  readonly addressLine: string;
  readonly houseNumber: number;
  readonly departmentCode: number;
  readonly districtCode: number | null;
  readonly cityCode: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EstablishmentListResponse {
  readonly items: EstablishmentResponse[];
}

export interface TimbradoRangeResponse {
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
  readonly status: TimbradoRangeView["status"];
}

export interface TimbradoRangeListResponse {
  readonly items: TimbradoRangeResponse[];
}

/**
 * FISC-016 WU-D: what the void command answers with — the record of the attempt.
 *
 * The provider's answer travels in its own fields and the operator's `reason` is
 * kept apart from the provider's message. The raw provider snapshots are
 * CONFIDENTIAL and deliberately never returned, exactly like the issuance and
 * cancellation responses.
 */
export interface FiscalRangeVoidResponse {
  readonly id: string;
  readonly rangeId: string;
  readonly fromNumber: number;
  readonly toNumber: number;
  readonly reason: string;
  readonly outcome: FiscalRangeVoidView["outcome"];
  readonly reasonCode: string | null;
  readonly providerReason: string | null;
  readonly providerReference: string | null;
  readonly rangeStatus: FiscalRangeVoidView["rangeStatus"];
  readonly createdAt: string;
}

export function toEmitterProfileResponse(view: EmitterProfileView): EmitterProfileResponse {
  return {
    ruc: view.ruc,
    checkDigit: view.checkDigit,
    taxpayerType: view.taxpayerType,
    regimeCode: view.regimeCode,
    legalName: view.legalName,
    tradeName: view.tradeName,
    transactionType: view.transactionType,
    taxType: view.taxType,
    emissionType: view.emissionType,
    activities: view.activities.map(({ code, description }) => ({ code, description })),
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

export function toEstablishmentResponse(view: EstablishmentView): EstablishmentResponse {
  return {
    id: view.id,
    code: view.code,
    addressLine: view.addressLine,
    houseNumber: view.houseNumber,
    departmentCode: view.departmentCode,
    districtCode: view.districtCode,
    cityCode: view.cityCode,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

export function toFiscalRangeVoidResponse(view: FiscalRangeVoidView): FiscalRangeVoidResponse {
  return {
    id: view.id,
    rangeId: view.rangeId,
    fromNumber: view.fromNumber,
    toNumber: view.toNumber,
    reason: view.reason,
    outcome: view.outcome,
    reasonCode: view.reasonCode,
    providerReason: view.providerReason,
    providerReference: view.providerReference,
    rangeStatus: view.rangeStatus,
    createdAt: view.createdAt.toISOString(),
  };
}

export function toTimbradoRangeResponse(view: TimbradoRangeView): TimbradoRangeResponse {
  return {
    id: view.id,
    establishmentId: view.establishmentId,
    expeditionPoint: view.expeditionPoint,
    documentType: view.documentType,
    series: view.series,
    timbradoNumber: view.timbradoNumber,
    rangeFrom: view.rangeFrom,
    rangeTo: view.rangeTo,
    // `tdFeIniT` is a date; the column is a timestamptz anchored to midnight UTC.
    validityStart: view.validityStart.toISOString().slice(0, 10),
    nextNumber: view.nextNumber,
    status: view.status,
  };
}
