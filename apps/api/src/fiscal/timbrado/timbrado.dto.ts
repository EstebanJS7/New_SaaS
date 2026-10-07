import type {
  EmitterProfileView,
  EstablishmentView,
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
