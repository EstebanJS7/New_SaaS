/**
 * FISC-011 — the descriptions the DE carries alongside its enumerated codes.
 *
 * The Manual's field table pairs each code with a description, and the DE emits
 * both (`iTiDE` and `dDesTiDE`, `iTImp` and `dDesTImp`, and so on). They are
 * derived here rather than stored, because storing them would be a second source
 * for a closed set — see the Story's Database section.
 *
 * **The pairing is by CODE, never by position, and that is not a stylistic
 * choice.** `tdDesTiTran` is the trap: the Manual's §D1 table lists **13**
 * transaction types with their descriptions, and `DE_Types_v150.xsd`'s
 * `tdDesTiTran` enumerates only **11** — the Manual's list with codes 3 and 7
 * removed and the rest left in order. So the third entry of the XSD enum is the
 * description of code **4**, and a positional mapping would quietly give every
 * transaction type from 3 upward the wrong text. Every catalogue below is keyed
 * by the code it belongs to.
 *
 * Sources, all retrieved and quoted in `SIFEN-BASELINE.md`:
 *
 * ```text
 * tiTiDE     1|4|5|6|7|9|10     tdDesTiDE      7 values   DE_Types_v150.xsd
 * tiTImp     1..5               tdDesTImp      5 values   DE_Types_v150.xsd
 * tiTipTra   1..13              tdDesTiTran   11 values   DE_Types_v150.xsd
 *                               dDesTipTra    13 values   Manual p.66, D011/D012
 * iTipEmi    1|2                tdDesTipEmi    2 values   DE_Types_v150.xsd
 * tDepartamentos 1..20          tDesDepartamento 20      Departamentos_v141.xsd
 * ```
 */

import {
  T_IMP_VALUES,
  TI_DE_VALUES,
  TIP_CONT_VALUES,
  TIP_TRA_VALUES,
  type DteTipoContribuyente,
  type DteTipoDocumentoElectronico,
  type DteTipoImpuesto,
  type DteTipoTransaccion,
} from "./dte.types.js";

/**
 * One enumerated code and the description the DE carries with it.
 *
 * Generic in the description as well as the code, so a catalogue declared with
 * `as const` keeps its literal descriptions: `entryFor` can then hand back
 * `"Normal" | "Contingencia"` where `EmitterFiscalProfile` demands that union
 * rather than a string.
 */
export interface DteCodeDescription<C extends number = number, D extends string = string> {
  readonly code: C;
  readonly description: D;
}

export type DteCatalogueFailure = "UNKNOWN_CODE" | "INVALID_CODE";

export class DteCatalogueError extends Error {
  readonly failure: DteCatalogueFailure;

  constructor(failure: DteCatalogueFailure, message: string) {
    super(message);
    this.name = "DteCatalogueError";
    this.failure = failure;
  }
}

/**
 * `tiTiDE` / `tdDesTiDE`, keyed by code.
 *
 * **Five of the seven pairings are stated by the Manual** (p. 63, C002/C003):
 * `1` Factura electrónica, `4` Autofactura, `5` Nota de crédito, `6` Nota de
 * débito, `7` Nota de remisión. The Manual's table also lists `2`, `3` and `8`,
 * each marked "(Futuro)" — and none of those three is in `tiTiDE`, which admits
 * `1|4-7|9|10`. So the XSD's enum is the gate and the Manual's table is not.
 *
 * `9` and `10` appear in **neither** the Manual's table nor anywhere else: their
 * descriptions ("Boleta de venta electrónica", "Boleta resimple electrónica")
 * exist only in `tdDesTiDE`. They are placed by elimination — the five
 * corroborated pairs take the first five entries, leaving the last two for `9`
 * and `10` in that order.
 */
export const DTE_DOCUMENT_TYPE_DESCRIPTIONS: readonly DteCodeDescription<DteTipoDocumentoElectronico>[] =
  [
    { code: 1, description: "Factura electrónica" },
    { code: 4, description: "Autofactura electrónica" },
    { code: 5, description: "Nota de crédito electrónica" },
    { code: 6, description: "Nota de débito electrónica" },
    { code: 7, description: "Nota de remisión electrónica" },
    { code: 9, description: "Boleta de venta electrónica" },
    { code: 10, description: "Boleta resimple electrónica" },
  ];

/** `tiTImp` / `tdDesTImp`: five codes, five descriptions, in order. */
export const DTE_TAX_TYPE_DESCRIPTIONS: readonly DteCodeDescription<DteTipoImpuesto>[] = [
  { code: 1, description: "IVA" },
  { code: 2, description: "ISC" },
  { code: 3, description: "Renta" },
  { code: 4, description: "Ninguno" },
  { code: 5, description: "IVA - Renta" },
];

/**
 * `tiTipTra` / `dDesTipTra`, from the **Manual's** table (p. 66, D011/D012),
 * which is the only source that states all thirteen pairings.
 *
 * `tdDesTiTran` admits only eleven of these descriptions, so a DE carrying code
 * 3 or 7 with its Manual description is **not schema-valid**. That is a
 * disagreement between the Manual and the XSD, not a transcription choice, and
 * it is recorded in the Story rather than resolved by guessing a substitute.
 */
export const DTE_TRANSACTION_TYPE_DESCRIPTIONS: readonly DteCodeDescription<DteTipoTransaccion>[] =
  [
    { code: 1, description: "Venta de mercadería" },
    { code: 2, description: "Prestación de servicios" },
    { code: 3, description: "Mixto (Venta de mercadería y servicios)" },
    { code: 4, description: "Venta de activo fijo" },
    { code: 5, description: "Venta de divisas" },
    { code: 6, description: "Compra de divisas" },
    { code: 7, description: "Promoción o entrega de muestras" },
    { code: 8, description: "Donación" },
    { code: 9, description: "Anticipo" },
    { code: 10, description: "Compra de productos" },
    { code: 11, description: "Compra de servicios" },
    { code: 12, description: "Venta de crédito fiscal" },
    { code: 13, description: "Muestras médicas (Art. 3 RG 24/2014)" },
  ];

/**
 * `iTipEmi` / `tdDesTipEmi`: `1 = "Normal"`, `2 = "Contingencia"`.
 *
 * `as const` because `EmitterFiscalProfile.emissionType.description` is the union
 * `"Normal" | "Contingencia"` rather than a string, so the lookup has to narrow.
 */
export const DTE_EMISSION_TYPE_DESCRIPTIONS = [
  { code: 1, description: "Normal" },
  { code: 2, description: "Contingencia" },
] as const satisfies readonly DteCodeDescription[];

/** The two descriptions `iTipEmi` can carry. */
export type DteEmissionTypeDescription =
  (typeof DTE_EMISSION_TYPE_DESCRIPTIONS)[number]["description"];

/**
 * `tDepartamentos` / `tDesDepartamento`, the twenty pairs from
 * `Departamentos_v141.xsd`. Both enumerations live in that file in the same
 * order, so this one IS positional — and the file is the authority for `D111`.
 */
export const DTE_DEPARTMENT_NAMES: readonly DteCodeDescription<number>[] = [
  { code: 1, description: "CAPITAL" },
  { code: 2, description: "CONCEPCION" },
  { code: 3, description: "SAN PEDRO" },
  { code: 4, description: "CORDILLERA" },
  { code: 5, description: "GUAIRA" },
  { code: 6, description: "CAAGUAZU" },
  { code: 7, description: "CAAZAPA" },
  { code: 8, description: "ITAPUA" },
  { code: 9, description: "MISIONES" },
  { code: 10, description: "PARAGUARI" },
  { code: 11, description: "ALTO PARANA" },
  { code: 12, description: "CENTRAL" },
  { code: 13, description: "NEEMBUCU" },
  { code: 14, description: "AMAMBAY" },
  { code: 15, description: "PTE. HAYES" },
  { code: 16, description: "BOQUERON" },
  { code: 17, description: "ALTO PARAGUAY" },
  { code: 18, description: "CANINDEYU" },
  { code: 19, description: "CHACO" },
  { code: 20, description: "NUEVA ASUNCION" },
];

/**
 * The catalogue entry for a code: the CODE NARROWED to the protocol's union,
 * plus its description.
 *
 * The stored columns are plain integers, so a lookup that returned only the
 * description would leave the caller casting the code back into the union. This
 * returns both, which is what makes the assembly cast-free.
 */
export function entryFor<C extends number, D extends string>(
  catalogue: readonly DteCodeDescription<C, D>[],
  code: number,
  label: string
): DteCodeDescription<C, D> {
  assertIntegerCode(code, label);
  const found = catalogue.find((entry) => entry.code === code);
  if (found === undefined) {
    throw new DteCatalogueError(
      "UNKNOWN_CODE",
      `${String(code)} is not a ${label}; the catalogue holds ` +
        `${catalogue.map((entry) => String(entry.code)).join(", ")}.`
    );
  }
  return found;
}

/** Narrows a code the DE has no description for, or fails naming it. */
export function narrowCode<C extends number>(
  allowed: readonly C[],
  code: number,
  label: string
): C {
  assertIntegerCode(code, label);
  const found = allowed.find((candidate) => candidate === code);
  if (found === undefined) {
    throw new DteCatalogueError(
      "UNKNOWN_CODE",
      `${String(code)} is not a ${label}; the schema admits ${allowed.join(", ")}.`
    );
  }
  return found;
}

/** `tiTipCont`: `iTipCont` carries no description, so there is no catalogue. */
export function narrowTaxpayerType(code: number): DteTipoContribuyente {
  return narrowCode(TIP_CONT_VALUES, code, "taxpayer type");
}

/** The codes the DE admits for each set, re-exported for a caller that needs them. */
export const DTE_TAX_TYPE_CODES = T_IMP_VALUES;
export const DTE_DOCUMENT_TYPE_CODES = TI_DE_VALUES;
export const DTE_TRANSACTION_TYPE_CODES = TIP_TRA_VALUES;

/** The description for a document type, or a failure naming the code. */
export function describeDocumentType(code: number): string {
  return describeFrom(DTE_DOCUMENT_TYPE_DESCRIPTIONS, code, "document type");
}

/** The description for a tax type, or a failure naming the code. */
export function describeTaxType(code: number): string {
  return describeFrom(DTE_TAX_TYPE_DESCRIPTIONS, code, "tax type");
}

/** The description for a transaction type, or a failure naming the code. */
export function describeTransactionType(code: number): string {
  return describeFrom(DTE_TRANSACTION_TYPE_DESCRIPTIONS, code, "transaction type");
}

/** The description for an emission type, or a failure naming the code. */
export function describeEmissionType(code: number): DteEmissionTypeDescription {
  return describeFrom(DTE_EMISSION_TYPE_DESCRIPTIONS, code, "emission type");
}

/** The department name for a code, or a failure naming the code. */
export function describeDepartment(code: number): string {
  return describeFrom(DTE_DEPARTMENT_NAMES, code, "department");
}

function assertIntegerCode(code: number, label: string): void {
  if (!Number.isInteger(code)) {
    throw new DteCatalogueError(
      "INVALID_CODE",
      `A ${label} is an integer code, received ${String(code)}.`
    );
  }
}

function describeFrom<D extends string>(
  catalogue: readonly { readonly code: number; readonly description: D }[],
  code: number,
  label: string
): D {
  if (!Number.isInteger(code)) {
    throw new DteCatalogueError(
      "INVALID_CODE",
      `A ${label} is an integer code, received ${String(code)}.`
    );
  }
  const found = catalogue.find((entry) => entry.code === code);
  if (found === undefined) {
    throw new DteCatalogueError(
      "UNKNOWN_CODE",
      `${String(code)} is not a ${label}; the catalogue holds ` +
        `${catalogue.map((entry) => String(entry.code)).join(", ")}.`
    );
  }
  return found.description;
}
