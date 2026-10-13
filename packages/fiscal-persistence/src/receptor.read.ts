import type { Prisma } from "@newsaas/database";
import {
  computeCdcCheckDigit,
  countryFor,
  describeReceptorIdentityType,
  DteCatalogueError,
  type DteReceptor,
  type DteTipoContribuyente,
  type DteTipoDocumentoElectronico,
  type DteTipoDocumentoReceptor,
  type DteTipoOperacion,
} from "@newsaas/fiscal";
import type { FiscalOperationType } from "./customer-fiscal.read.js";

/**
 * FISC-015 WU-D — the customer's rows to the `DteReceptor` the mapper consumes.
 *
 * [[DEC-057]] Q2 decided that the receptor is **derived where the sources pin it
 * and declared where they do not**. This read is that derivation, and every
 * field below names its source:
 *
 * ```text
 * iNatRec        taxId !== null ? 1 : 2                 D201 (§22.3)
 * iTiOpe         1 B2B, 2 B2C, 3 B2G, 4 B2F             D202 (§22.3, corrected
 *                from the tenant's DECLARED             pairing; NT 010's
 *                fiscal_operation_type                  D202/1300 agrees)
 * cPaisRec       PRY, or the country the customer's      §22.3 / Paises_v100.xsd
 * dDesPaisRe     address carries; the artifact's name    (§22.6)
 * iTiContRec     1 INDIVIDUAL, 2 COMPANY                 D103 (§22.4)
 * dRucRec        taxId, without its check digit          D206 (§22.3)
 * dDVRec         módulo 11 over that RUC, COMPUTED       D207 (§22.3)
 * iTipIDRec      1 for documentNumber, 5 for innominado   D208 (§22.11)
 * dDTipIDRec     the code's own description               tiTipDocRec
 * dNumIDRec      documentNumber, or "0" for innominado    D210 (§22.11)
 * dNomRec        legalName ?? displayName, or "Sin Nombre" D208's annotations
 * ```
 *
 * **`iTiOpe` is read, never derived.** `B2G` depends on the DNIT's registry of
 * state entities and `B2B`/`B2C`/`B2F` on facts only the tenant knows, so the
 * customer's `fiscal_operation_type` is the source — **nullable and not
 * defaulted** — and `NULL` is a refusal. [[DEC-057]] invented no default for it,
 * and this read does not either.
 *
 * **A receptor with no customer row is refused, not guessed.** `Invoice.customerId`
 * is nullable, so a walk-in invoice reaches this read with nothing to read: there
 * is no row to declare an operation type on, and choosing one (`B2C` because an
 * innominado receptor must be B2C, say) would be this code answering a question
 * the tenant did not. The innominado case is reachable — it is a customer row
 * whose identity columns are both `NULL` — and that is the shape a walk-in
 * invoice takes today: one "consumidor final" row per tenant.
 *
 * **The address group is not built, and the two cases that require it are
 * refused.** `D213 dDirRec` is obligatory for a remission note (`C002 = 7`) and
 * for an exterior operation (`D202 = 4` / B2F), and `D219`/`D223` are its
 * dependants: §22.11 records both as "obligatorio si se informa `D213`" (NT 003
 * moved those conditions onto the fields) and both as "no informar si
 * `D202 = 4`". This read cannot build the group at all: the Manual's
 * **Tabla 2.2 – Ciudades** is not profiled anywhere in this repository (§19
 * records it as open), so there is no source for `cCiuRec`, and
 * `customer_address` carries free text (`city`, `state`) rather than the
 * protocol's codes. For the factura this Story issues (`C002 = 1`, `D202 != 4`)
 * the group is not required, so it is omitted — and the two cases that DO
 * require it refuse, because an incomplete address is a document SIFEN rejects.
 * **That gap is a finding for the Story**, recorded in the unit's report rather
 * than invented around.
 *
 * **The innominado rules are enforced before SIFEN sees them.** Only for B2C
 * (`D208b`/1319, `D208f`/1333), never for a credit, debit or remission note
 * (`D208e`/1331), and — the part this read cannot see — not above the threshold
 * (`D208c`/1321, NT 024's 7,000,000), which needs the operation's total and is
 * `dte.rules.ts`'s `assertReceptor` at build time.
 *
 * **`tenantId` is an argument, not ambient context.** Both queries put it in the
 * `where`, so a foreign customer id can only produce the same refusal an absent
 * one does — never another tenant's receptor.
 *
 * **Absence is a refusal, not an error state.** Every path either answers a
 * `DteReceptor` or throws `ReceptorReadError`; there is no `null` answer, because
 * a document without a receptor is not a document this read can produce.
 */

/** `Customer.kind`'s two members (`customer_kind`). A third would break the fit. */
export type StoredCustomerKind = "INDIVIDUAL" | "COMPANY";

/** One `customer` row, in the columns this read needs. */
export interface CustomerReceptorRow {
  readonly kind: StoredCustomerKind;
  readonly displayName: string;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly documentNumber: string | null;
  /** `D202 iTiOpe` as the tenant declared it; `null` is "not declared". */
  readonly fiscalOperationType: FiscalOperationType | null;
}

/** One `customer_address` row, in the one column this read needs. */
export interface CustomerAddressCountryRow {
  readonly countryCode: string | null;
}

/**
 * The delegate surface, in Prisma's own terms.
 *
 * Declared structurally so the Prisma client fits by construction and a test can
 * pass a fake that records the statements — the same shape the credential read
 * and the profile read use.
 */
export interface ReceptorReadClient {
  customer: {
    findFirst(args: Prisma.CustomerFindFirstArgs): Promise<CustomerReceptorRow | null>;
  };
  customerAddress: {
    findMany(
      args: Prisma.CustomerAddressFindManyArgs
    ): Promise<readonly CustomerAddressCountryRow[]>;
  };
}

/**
 * Why a receptor could not be built. Each is a state of the tenant's own rows or
 * of the document the caller asked for, and each is a refusal rather than a
 * default.
 */
export type ReceptorRefusal =
  | "RECEPTOR_CUSTOMER_ABSENT"
  | "OPERATION_TYPE_NOT_DECLARED"
  | "INVALID_TAX_ID"
  | "TAX_ID_CHECK_DIGIT_MISMATCH"
  | "INVALID_IDENTITY_DOCUMENT"
  | "INVALID_RECEPTOR_NAME"
  | "INNOMINADO_NOT_B2C"
  | "INNOMINADO_DOCUMENT_TYPE"
  | "RECEPTOR_ADDRESS_UNAVAILABLE"
  | "RECEPTOR_COUNTRY_UNSUPPORTED"
  | "RECEPTOR_COUNTRY_AMBIGUOUS";

export class ReceptorReadError extends Error {
  readonly refusal: ReceptorRefusal;

  constructor(refusal: ReceptorRefusal, message: string) {
    super(message);
    this.name = "ReceptorReadError";
    this.refusal = refusal;
  }
}

export interface ReceptorReadArgs {
  readonly tenantId: string;
  /** `Invoice.customerId`. `null` is refused: there is nothing to read. */
  readonly customerId: string | null;
  /**
   * `C002 iTiDE` — **the caller's**, because two of the receptor's rules are
   * conditional on the document type: `D208e`/1331 forbids an innominado
   * receptor on a credit, debit or remission note (5, 6, 7) and `D213` requires
   * the address on a remission note (7).
   */
  readonly documentType: DteTipoDocumentoElectronico;
}

/**
 * `D202`'s four names as the protocol's own codes — `1` B2B, `2` B2C, `3` B2G,
 * `4` B2F.
 *
 * **This pairing is the corrected one.** `SIFEN-BASELINE.md` §22.3 first
 * recorded `D202 = 4` as B2C; the Manual's own receptor table ("1= B2B 2= B2C
 * 3= B2G 4= B2F (Esta última opción debe utilizarse solo en caso de servicios
 * para empresas o personas físicas del exterior)") and NT 010's validation
 * `D202`/1300 both contradict it, and §22.3 carries the correction. The column
 * stores the four NAMES rather than the codes precisely so a re-reading cannot
 * reintroduce the wrong one — which makes this map the single place the pairing
 * is resolved, and the reason it is keyed by name.
 */
const OPERATION_TYPE_CODES: Record<FiscalOperationType, DteTipoOperacion> = {
  B2B: 1,
  B2C: 2,
  B2G: 3,
  B2F: 4,
};

/** `D202 = 4` (B2F): the only operation type `D213` requires an address for. */
const EXTERIOR_OPERATION_CODE: DteTipoOperacion = 4;

/** `D103`'s pairing for `D203 iTiContRec` (§22.4), keyed by name as the column is. */
const TAXPAYER_TYPE_BY_KIND: Record<StoredCustomerKind, DteTipoContribuyente> = {
  INDIVIDUAL: 1,
  COMPANY: 2,
};

/** `D208 = 5` — the innominado receptor, and `D208e`'s `C002` set. */
const INNOMINADO: DteTipoDocumentoReceptor = 5;
const NOTES_WITHOUT_INNOMINADO: readonly DteTipoDocumentoElectronico[] = [5, 6, 7];

/**
 * The identity-document type this read assumes when the customer carries a
 * `documentNumber`.
 *
 * **The schema does not model which document it is** — `customer.documentNumber`
 * is free text, and `D208` admits four real types (cédula paraguaya, pasaporte,
 * cédula extranjera, carnet de residencia) plus `Tarjeta Diplomática` and `Otro`.
 * `1` is the assumption, because this is a Paraguayan taxpayer's system and a
 * cédula is what a national customer's number is; a tenant whose customers hand
 * over passports has no way to say so today. **That is a finding, not a
 * default**: the value is asserted in the suite and recorded in this unit's
 * report, and a future column is what would remove the assumption.
 */
const ASSUMED_IDENTITY_TYPE: DteTipoDocumentoReceptor = 1;

/**
 * `tRuc` (§21.3): `minLength 3`, `maxLength 8`, `[1-9][0-9]*` with an optional
 * trailing check digit. The certificate's own `RUCXXXXXXXXX-X` shape is longer
 * and is not what `dRucRec` carries.
 */
const TAX_ID_PATTERN = /^([1-9][0-9]{2,7})(?:-([0-9A-D]))?$/;

/**
 * `tdNumDocId` (§21.3, `DE_Types_v150.xsd`): `[0-9A-Za-z-]{1,20}`.
 */
const IDENTITY_DOCUMENT_PATTERN = /^[0-9A-Za-z-]{1,20}$/;

/** `tdNombre` (`dNomRec`'s own type): `minLength 4`, `maxLength 255`. */
const NAME_MIN_LENGTH = 4;
const NAME_MAX_LENGTH = 255;

export function createReceptorReader(client: ReceptorReadClient): {
  /**
   * The receptor a DE may carry, or a `ReceptorReadError` naming what the
   * tenant's rows do not decide.
   */
  readReceptor(args: ReceptorReadArgs): Promise<DteReceptor>;
} {
  return {
    async readReceptor({ tenantId, customerId, documentType }) {
      if (customerId === null) {
        throw new ReceptorReadError(
          "RECEPTOR_CUSTOMER_ABSENT",
          "The invoice names no customer, so no row declares its fiscal operation type " +
            "(iTiOpe). DEC-057 invented no default for it, and a walk-in receptor is a " +
            "customer row with no identity rather than a missing row."
        );
      }
      // `findFirst` with BOTH columns in the `where`, never `findUnique` on the
      // customer id alone: the tenant is part of the identity, so a foreign
      // customer id cannot match another tenant's row.
      const row = await client.customer.findFirst({ where: { tenantId, id: customerId } });
      if (row === null) {
        throw new ReceptorReadError(
          "RECEPTOR_CUSTOMER_ABSENT",
          "No customer of this tenant answers the invoice's customerId, so there is no " +
            "declared fiscal operation type (iTiOpe) to build a receptor from."
        );
      }
      if (row.fiscalOperationType === null) {
        throw new ReceptorReadError(
          "OPERATION_TYPE_NOT_DECLARED",
          "This customer has no declared fiscal_operation_type (iTiOpe). DEC-057 chose a " +
            "declaration over a derivation and invented no default for the four values, so " +
            "issuance refuses rather than inferring one from the customer's kind."
        );
      }
      const iTiOpe = OPERATION_TYPE_CODES[row.fiscalOperationType];
      const iTiContRec = TAXPAYER_TYPE_BY_KIND[row.kind];

      // The receptor's own identity first: a receptor that cannot be identified
      // is refused before its address is considered, so the refusal a caller
      // reads names the fact that is missing rather than the one that follows
      // from it.
      const identity = identityOf(row, iTiOpe, documentType);

      // `D213`, with `D219`/`D223` behind it (§22.11; NT 003 moved those
      // conditions onto the fields themselves). Both cases below need an address
      // this repository cannot build — see the module header.
      if (documentType === 7 || iTiOpe === EXTERIOR_OPERATION_CODE) {
        throw new ReceptorReadError(
          "RECEPTOR_ADDRESS_UNAVAILABLE",
          `A ${documentType === 7 ? "remission note" : "B2F (exterior) operation"} requires the ` +
            "receptor's address (D213), and its city is D223 cCiuRec, which is the Manual's " +
            "Tabla 2.2 — not profiled anywhere in this repository. customer_address carries " +
            "free text (city, state), not the protocol's codes, so the address cannot be built."
        );
      }

      const country = await readCountry(client, tenantId, customerId);

      return { iNatRec: identity.iNatRec, iTiOpe, ...country, iTiContRec, ...identity.identity };
    },
  };
}

/**
 * The identity half of the receptor: `iNatRec`, the RUC or the identity document,
 * and the name. Split out because it is the part with three mutually exclusive
 * shapes, and each shape's rule is a different source.
 */
function identityOf(
  row: CustomerReceptorRow,
  iTiOpe: DteTipoOperacion,
  documentType: DteTipoDocumentoElectronico
): {
  readonly iNatRec: 1 | 2;
  readonly identity: Pick<
    DteReceptor,
    "iTipIDRec" | "dDTipIDRec" | "dNumIDRec" | "dRucRec" | "dDVRec" | "dNomRec"
  >;
} {
  // D201 / D206 / D207: `taxId !== null` is a contribuyente, and its RUC carries
  // the check digit the protocol computes rather than stores. A `documentNumber`
  // on the same row is NOT informed: D208 says so for D201 = 1 (NT 023), and
  // that is a rule rather than a choice — the field is forbidden, not optional.
  if (row.taxId !== null) {
    const { ruc, checkDigit } = parseTaxId(row.taxId);
    return {
      iNatRec: 1,
      identity: {
        dRucRec: ruc,
        dDVRec: checkDigit,
        dNomRec: receptorName(row),
      },
    };
  }

  // D208 / D209 / D210 for a non-contributor: the identity document, whose type
  // the schema does not model — see ASSUMED_IDENTITY_TYPE.
  if (row.documentNumber !== null) {
    if (!IDENTITY_DOCUMENT_PATTERN.test(row.documentNumber)) {
      throw new ReceptorReadError(
        "INVALID_IDENTITY_DOCUMENT",
        `The customer's documentNumber cannot be carried by dNumIDRec (tdNumDocId: 1 to 20 ` +
          `characters of [0-9A-Za-z-]).`
      );
    }
    return {
      iNatRec: 2,
      identity: {
        iTipIDRec: ASSUMED_IDENTITY_TYPE,
        dDTipIDRec: describeReceptorIdentityType(ASSUMED_IDENTITY_TYPE),
        dNumIDRec: row.documentNumber,
        dNomRec: receptorName(row),
      },
    };
  }

  // Neither: the innominado receptor, and the Manual's own three annotations —
  // D208 = 5, dNumIDRec = 0, dNomRec = "Sin Nombre". The constraints around it
  // are Notas Técnicas, not the Manual, and they are ours to enforce.
  if (iTiOpe !== OPERATION_TYPE_CODES.B2C) {
    // D208b / 1319 (NT 010) and D208f / 1333 (NT 023): the same condition, the
    // second restating the first when NT 023 reworded the identity fields.
    throw new ReceptorReadError(
      "INNOMINADO_NOT_B2C",
      "An innominado receptor requires iTiOpe = 2 (B2C); D208b/1319 and D208f/1333 forbid " +
        "it for every other operation type."
    );
  }
  if (NOTES_WITHOUT_INNOMINADO.includes(documentType)) {
    // D208e / 1331 (NT 023).
    throw new ReceptorReadError(
      "INNOMINADO_DOCUMENT_TYPE",
      `D208e/1331 forbids an innominado receptor for document type ${String(
        documentType
      )}: a credit note (5), a debit note (6) and a remission note (7) all carry a receptor ` +
        "the tenant identified."
    );
  }
  return {
    iNatRec: 2,
    identity: {
      iTipIDRec: INNOMINADO,
      dDTipIDRec: describeReceptorIdentityType(INNOMINADO),
      dNumIDRec: "0",
      dNomRec: "Sin Nombre",
    },
  };
}

/** `dNomRec`: `legalName ?? displayName`, at `tdNombre`'s own length. */
function receptorName(row: CustomerReceptorRow): string {
  const name = row.legalName ?? row.displayName;
  if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    throw new ReceptorReadError(
      "INVALID_RECEPTOR_NAME",
      `dNomRec (tdNombre) carries 4 to 255 characters, and this customer's name carries ` +
        `${String(name.length)}.`
    );
  }
  return name;
}

/**
 * `dRucRec` and `dDVRec` from the stored `taxId`.
 *
 * The check digit is **computed, never copied**: D207 says "según algoritmo
 * módulo 11", and the same `Pa_Calcular_Dv_11_A` this package already
 * implements for the CDC's `dDVId` is what the Manual cites for a RUC. When the
 * stored value carries a check digit of its own (the Manual's `RUC-DV` shape,
 * which the API's free-text `taxId` admits) it is **checked and then dropped**:
 * a stored digit that disagrees with the computation is a defect worth refusing
 * over, and it is still not the source.
 */
function parseTaxId(taxId: string): { readonly ruc: string; readonly checkDigit: string } {
  const match = TAX_ID_PATTERN.exec(taxId.trim());
  if (match === null) {
    throw new ReceptorReadError(
      "INVALID_TAX_ID",
      "dRucRec's type is tRuc: three to eight characters, [1-9][0-9]* with an optional " +
        "trailing check digit. The stored taxId is not a RUC this DE can carry."
    );
  }
  const ruc = match[1] ?? "";
  const declared = match[2];
  const checkDigit = String(computeCdcCheckDigit(ruc));
  if (declared !== undefined && declared !== checkDigit) {
    throw new ReceptorReadError(
      "TAX_ID_CHECK_DIGIT_MISMATCH",
      `The stored taxId carries check digit ${declared} and módulo 11 over ${ruc} answers ` +
        `${checkDigit}. D207 makes the algorithm the source, so the row is refused rather ` +
        "than believed."
    );
  }
  return { ruc, checkDigit };
}

/**
 * `cPaisRec` and `dDesPaisRe`.
 *
 * **`PRY` is the answer when the customer carries no country, and that is the
 * only honest one**: this is a Paraguayan taxpayer's document, the customer's
 * rows carry no other country, and inventing one is not a choice this read may
 * make. When an address DOES carry a country, it is the one the artifact
 * publishes — and a code the artifact does not publish is refused, which is what
 * a stored alpha-2 (`"PY"`) is: `customer_address.country_code` is validated as
 * ISO 3166 alpha-2 while `cPaisRec` is `paisType`'s alpha-3.
 *
 * Two active addresses that disagree are refused rather than picked: nothing in
 * the repository says which one is the receptor's, and there is no primary flag
 * to consult.
 */
async function readCountry(
  client: ReceptorReadClient,
  tenantId: string,
  customerId: string
): Promise<{ readonly cPaisRec: string; readonly dDesPaisRe: string }> {
  const addresses = await client.customerAddress.findMany({
    where: { tenantId, customerId, isActive: true },
    select: { countryCode: true },
    orderBy: { id: "asc" },
  });
  const codes = new Set(
    addresses.map((row) => row.countryCode).filter((code): code is string => code !== null)
  );
  if (codes.size > 1) {
    throw new ReceptorReadError(
      "RECEPTOR_COUNTRY_AMBIGUOUS",
      `The customer's active addresses carry ${String(codes.size)} different countries ` +
        `(${[...codes].sort().join(", ")}), and nothing in this repository says which address ` +
        "is the receptor's."
    );
  }
  const code = [...codes][0] ?? "PRY";
  try {
    const country = countryFor(code);
    return { cPaisRec: country.code, dDesPaisRe: country.description };
  } catch (error) {
    if (error instanceof DteCatalogueError) {
      throw new ReceptorReadError("RECEPTOR_COUNTRY_UNSUPPORTED", error.message);
    }
    throw error;
  }
}
