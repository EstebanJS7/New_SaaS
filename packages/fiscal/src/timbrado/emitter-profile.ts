/**
 * FISC-011 WU-E — assembling the `EmitterFiscalProfile` the mapper takes.
 *
 * [[FISC-008]]'s `buildDteRequestFromInvoice` takes the profile as an **input**;
 * DEC-054 chose that so the mapper stayed pure and the storage decision landed in
 * this Story. This module is the other side of that seam: it turns the stored
 * rows into the profile, and it is the only place that knows how a stored column
 * becomes a DE field.
 *
 * **Three things it does not do, and the reason each matters:**
 *
 * 1. **It does not allocate.** The document number arrives already allocated,
 *    because the number is part of the CDC and allocating it is a stateful,
 *    transactional act — `allocateDocumentNumber` owns that.
 * 2. **It does not store descriptions.** The DE carries a description beside each
 *    enumerated code, and every one of them is derived from the code through
 *    `dte.catalogues.ts`. Storing them would be a second source for a closed set.
 * 3. **It does not read a clock or a tenant.** Everything it needs is an argument.
 *
 * **The department name is derived, and the district and city names are not.**
 * `Departamentos_v141.xsd` enumerates the twenty department names, so the pair
 * cannot drift; the 272 districts and 6,766 cities are not enumerable, so those
 * names are stored and carried as they are.
 */

import {
  DTE_DOCUMENT_TYPE_DESCRIPTIONS,
  DTE_EMISSION_TYPE_DESCRIPTIONS,
  DTE_TAX_TYPE_DESCRIPTIONS,
  DTE_TRANSACTION_TYPE_DESCRIPTIONS,
  type DteEmissionTypeDescription,
  describeDepartment,
  entryFor,
  narrowTaxpayerType,
} from "../dte/dte.catalogues.js";
import type {
  DteActividadEconomica,
  DteEmisor,
  DteResponsableEmision,
  DteTimbrado,
} from "../dte/dte.types.js";
import type { EmitterFiscalProfile } from "../dte/dte.mapper.js";
import { DOCUMENT_NUMBER_WIDTH } from "./allocation.js";

export type EmitterProfileAssemblyFailure =
  "NO_ACTIVITY" | "INCOMPLETE_RESPONSIBLE_ISSUER" | "INVALID_DOCUMENT_NUMBER";

export class EmitterProfileAssemblyError extends Error {
  readonly failure: EmitterProfileAssemblyFailure;

  constructor(failure: EmitterProfileAssemblyFailure, message: string) {
    super(message);
    this.name = "EmitterProfileAssemblyError";
    this.failure = failure;
  }
}

/** The emitter profile row, as the assembly needs to see it. */
export interface StoredEmitterProfile {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly responsibleIssuerType: number | null;
  readonly responsibleIssuerTypeName: string | null;
  readonly responsibleIssuerId: string | null;
  readonly responsibleIssuerName: string | null;
  readonly responsibleIssuerRole: string | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
}

/** The establishment row. Its address is the DE's, and its code is `dEst`. */
export interface StoredEstablishment {
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
}

/** One `gActEco` entry, in its stored order. */
export interface StoredActivity {
  readonly code: string;
  readonly description: string;
}

/** The range's contribution to `gTimb`: everything but the number. */
export interface StoredTimbradoRange {
  readonly timbradoNumber: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  /** `dFeIniT`; stored anchored to midnight UTC, emitted as a date. */
  readonly validityStart: Date;
}

/** What `allocateDocumentNumber` produced for the DE being issued. */
export interface AllocatedNumber {
  /** `dNumDoc`: seven digits, zero-padded. */
  readonly documentNumber: string;
  /** `dSerieNum`, or `null` for the seriesless initial range. */
  readonly series: string | null;
}

export interface AssembleEmitterProfileArgs {
  readonly profile: StoredEmitterProfile;
  readonly establishment: StoredEstablishment;
  readonly activities: readonly StoredActivity[];
  readonly range: StoredTimbradoRange;
  readonly allocated: AllocatedNumber;
}

/**
 * Builds the profile the mapper consumes.
 *
 * Refuses rather than guesses: an empty `gActEco` and a half-filled `gRespDE` are
 * both states the schema's own constraints forbid, so meeting one means the input
 * did not come from the database.
 */
export function assembleEmitterProfile(args: AssembleEmitterProfileArgs): EmitterFiscalProfile {
  const { profile, establishment, activities, range, allocated } = args;

  assertDocumentNumber(allocated.documentNumber);
  if (activities.length === 0) {
    // `gActEco` is minOccurs=1: a DE with no economic activity is schema-invalid.
    throw new EmitterProfileAssemblyError(
      "NO_ACTIVITY",
      "A DE needs at least one economic activity: gActEco is required by the schema."
    );
  }

  // One lookup per code: `entryFor` returns the code NARROWED to the protocol's
  // union together with its description, so nothing here casts a stored integer
  // into a union the schema defines.
  const tax = entryFor(DTE_TAX_TYPE_DESCRIPTIONS, profile.taxType, "tax type");
  const emission = entryFor(DTE_EMISSION_TYPE_DESCRIPTIONS, profile.emissionType, "emission type");
  const transaction =
    profile.transactionType === null
      ? null
      : entryFor(DTE_TRANSACTION_TYPE_DESCRIPTIONS, profile.transactionType, "transaction type");

  return {
    emitter: buildEmitter(profile, establishment, activities),
    timbrado: buildTimbrado(establishment, range, allocated),
    operation: {
      iTImp: tax.code,
      dDesTImp: tax.description,
      ...(transaction === null
        ? {}
        : { iTipTra: transaction.code, dDesTipTra: transaction.description }),
    },
    emissionType: { code: emission.code, description: emission.description },
  };
}

/** `gEmis`: the tenant's identity plus the establishment's address. */
function buildEmitter(
  profile: StoredEmitterProfile,
  establishment: StoredEstablishment,
  activities: readonly StoredActivity[]
): DteEmisor {
  const responsible = buildResponsibleIssuer(profile);
  return {
    dRucEm: profile.ruc,
    dDVEmi: profile.checkDigit,
    iTipCont: narrowTaxpayerType(profile.taxpayerType),
    ...(profile.regimeCode === null ? {} : { cTipReg: String(profile.regimeCode) }),
    dNomEmi: profile.legalName,
    ...(profile.tradeName === null ? {} : { dNomFanEmi: profile.tradeName }),
    dDirEmi: establishment.addressLine,
    // `tdNumCas` is an integer in the schema and a string in the DE.
    dNumCas: String(establishment.houseNumber),
    ...(establishment.addressComplement1 === null
      ? {}
      : { dCompDir1: establishment.addressComplement1 }),
    ...(establishment.addressComplement2 === null
      ? {}
      : { dCompDir2: establishment.addressComplement2 }),
    cDepEmi: String(establishment.departmentCode),
    // Derived from the code: the twenty names are enumerated in the schema, so
    // storing this one would be a second source for a closed set.
    dDesDepEmi: describeDepartment(establishment.departmentCode),
    ...(establishment.districtCode === null
      ? {}
      : {
          cDisEmi: String(establishment.districtCode),
          dDesDisEmi: establishment.districtName ?? "",
        }),
    cCiuEmi: String(establishment.cityCode),
    dDesCiuEmi: establishment.cityName,
    dTelEmi: establishment.phone,
    dEmailE: establishment.email,
    ...(establishment.branchName === null ? {} : { dDenSuc: establishment.branchName }),
    gActEco: activities.map((activity): DteActividadEconomica => ({
      cActEco: activity.code,
      dDesActEco: activity.description,
    })),
    ...(responsible === undefined ? {} : { gRespDE: responsible }),
  };
}

/** `gRespDE`, optional as a whole: either every column is set or none is. */
function buildResponsibleIssuer(profile: StoredEmitterProfile): DteResponsableEmision | undefined {
  const { responsibleIssuerType, responsibleIssuerId } = profile;
  if (responsibleIssuerType === null) {
    return undefined;
  }
  const { responsibleIssuerTypeName, responsibleIssuerName, responsibleIssuerRole } = profile;
  if (
    responsibleIssuerTypeName === null ||
    responsibleIssuerId === null ||
    responsibleIssuerName === null ||
    responsibleIssuerRole === null
  ) {
    // The database's all-or-nothing CHECK forbids this, so reaching it means the
    // caller built the object by hand.
    throw new EmitterProfileAssemblyError(
      "INCOMPLETE_RESPONSIBLE_ISSUER",
      "gRespDE is optional as a whole: its five fields are set together or not at all."
    );
  }
  return {
    iTipIDRespDE: responsibleIssuerType,
    dDTipIDRespDE: responsibleIssuerTypeName,
    dNumIDRespDE: responsibleIssuerId,
    dNomRespDE: responsibleIssuerName,
    dCarRespDE: responsibleIssuerRole,
  };
}

/** `gTimb`: the Manual's identifying sequence, minus the number it was given. */
function buildTimbrado(
  establishment: StoredEstablishment,
  range: StoredTimbradoRange,
  allocated: AllocatedNumber
): DteTimbrado {
  const documentType = entryFor(
    DTE_DOCUMENT_TYPE_DESCRIPTIONS,
    range.documentType,
    "document type"
  );
  return {
    iTiDE: documentType.code,
    dDesTiDE: documentType.description,
    dNumTim: range.timbradoNumber,
    // `dEst` is the establishment's code, and `dPunExp` the range's point: the
    // Manual's sequence names both, and they come from different rows.
    dEst: establishment.code,
    dPunExp: range.expeditionPoint,
    dNumDoc: allocated.documentNumber,
    ...(allocated.series === null ? {} : { dSerieNum: allocated.series }),
    // `tdFeIniT` is a date; the column is a timestamptz anchored to midnight UTC.
    dFeIniT: range.validityStart.toISOString().slice(0, 10),
  };
}

/** `tdNumDoc`: exactly seven digits, never all zero. */
function assertDocumentNumber(documentNumber: string): void {
  if (!new RegExp(`^[0-9]{${String(DOCUMENT_NUMBER_WIDTH)}}$`).test(documentNumber)) {
    throw new EmitterProfileAssemblyError(
      "INVALID_DOCUMENT_NUMBER",
      `dNumDoc must be exactly ${String(DOCUMENT_NUMBER_WIDTH)} digits, received ` +
        `"${documentNumber}"; it comes from allocateDocumentNumber, which formats it.`
    );
  }
  if (/^0+$/.test(documentNumber)) {
    throw new EmitterProfileAssemblyError(
      "INVALID_DOCUMENT_NUMBER",
      "dNumDoc is never all zero: tdNumDoc forbids it."
    );
  }
}

/** Re-exported so a caller has the description type without a second import. */
export type { DteEmissionTypeDescription };
