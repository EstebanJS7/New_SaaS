/**
 * FISC-008 — composing the CDC, and its check digit.
 *
 * Both halves of the CDC are pinned, and this module is where they are encoded:
 *
 * - **The composition**, from the Manual's §10.1 table on page 56 — a picture of
 *   a table, recovered by rendering the page (baseline §22.9). Eleven fields, in
 *   this order, with these widths:
 *
 *   ```text
 *   iTiDE(2) dRucEm(8) dDVEmi(1) dEst(3) dPunExp(3) dNumDoc(7)
 *   iTipCont(1) dFeEmiDE(8, AAAAMMDD) iTipEmi(1) dCodSeg(9) dDVId(1) = 44
 *   ```
 *
 * - **The check digit**, from `Pa_Calcular_Dv_11_A` — the function the Manual's
 *   §10.2 cites, published by DNIT at
 *   `dnit.gov.py/documents/20123/224893/Dígito+Verificador.pdf` (HTTP 200,
 *   21,199 bytes, 3 pages) in PL/SQL, Visual Basic and C:
 *
 *   ```text
 *   weights 2,3,4,5,6,7,8,9,10,11 from the RIGHT, then restart   (p_basemax = 11)
 *   resto = total mod 11 ;  DV = resto > 1 ? 11 - resto : 0
 *   a non-digit character is replaced by its ASCII value
 *   ```
 *
 * It reproduces the Manual's own worked CDC
 * (`01444444017001001001452822017012515873260988`) and the RUC check digit in
 * all four example documents this vault holds.
 *
 * **Two published CDCs do NOT reproduce under it**, and they are named in the
 * tests rather than hidden: in both, the *RUC* digit checks out while the *CDC*
 * digit does not, which is the signature of illustrative CDCs written by hand
 * over real RUCs. See baseline §22.9.
 */

import type {
  DteTipoContribuyente,
  DteTipoDocumentoElectronico,
  DteTipoEmision,
} from "./dte.types.js";
import { DteValidationError } from "./dte.rules.js";

/** `p_basemax` in `Pa_Calcular_Dv_11_A`. Named because the document calls it that. */
export const CDC_CHECK_DIGIT_BASE_MAX = 11;

/** The composition's widths, in the Manual's order. Sums to 43, before `dDVId`. */
export const CDC_FIELD_WIDTHS = {
  iTiDE: 2,
  dRucEm: 8,
  dDVEmi: 1,
  dEst: 3,
  dPunExp: 3,
  dNumDoc: 7,
  iTipCont: 1,
  dFeEmiDE: 8,
  iTipEmi: 1,
  dCodSeg: 9,
} as const;

export interface DteCdcFields {
  readonly iTiDE: DteTipoDocumentoElectronico;
  /** The numeric RUC, zero-padded on the left to eight digits by this function. */
  readonly dRucEm: string;
  readonly dDVEmi: string;
  readonly dEst: string;
  readonly dPunExp: string;
  readonly dNumDoc: string;
  readonly iTipCont: DteTipoContribuyente;
  /** `AAAAMMDD`, or a full `fecHhmmss` from which the date part is taken. */
  readonly dFeEmiDE: string;
  readonly iTipEmi: DteTipoEmision;
  readonly dCodSeg: string;
}

export interface ComposedCdc {
  /** The 44-character CDC. */
  readonly cdc: string;
  /** Its check digit, which is also the CDC's last character. */
  readonly dDVId: string;
  /** The 43 characters the check digit was computed over. */
  readonly prefix: string;
}

/**
 * `Pa_Calcular_Dv_11_A`, transcribed literally. Weights run from the right and
 * restart after `baseMax`, so with the document's default of 11 a digit can be
 * multiplied by 10 or 11 — which is exactly the part an earlier search of this
 * vault missed when it only tried weights up to 9.
 */
export function computeCdcCheckDigit(prefix: string, baseMax = CDC_CHECK_DIGIT_BASE_MAX): number {
  if (baseMax < 2) {
    throw new DteValidationError("INVALID_CDC_FIELD", "The check-digit base must be at least 2.");
  }
  // "Cambia la ultima letra por ascii en caso que la cedula termine en letra":
  // any non-digit contributes its ASCII value, digit by digit.
  const normalized = [...prefix.toUpperCase()]
    .map((character) => (/[0-9]/.test(character) ? character : String(character.charCodeAt(0))))
    .join("");

  let weight = 2;
  let total = 0;
  for (const character of [...normalized].reverse()) {
    if (weight > baseMax) {
      weight = 2;
    }
    total += Number(character) * weight;
    weight += 1;
  }
  const remainder = total % 11;
  return remainder > 1 ? 11 - remainder : 0;
}

/** Composes the CDC from its eleven fields, computing the check digit. */
export function composeCdc(fields: DteCdcFields): ComposedCdc {
  const prefix = [
    padNumeric(String(fields.iTiDE), CDC_FIELD_WIDTHS.iTiDE, "iTiDE"),
    padNumeric(fields.dRucEm, CDC_FIELD_WIDTHS.dRucEm, "dRucEm"),
    padNumeric(fields.dDVEmi, CDC_FIELD_WIDTHS.dDVEmi, "dDVEmi"),
    padNumeric(fields.dEst, CDC_FIELD_WIDTHS.dEst, "dEst"),
    padNumeric(fields.dPunExp, CDC_FIELD_WIDTHS.dPunExp, "dPunExp"),
    padNumeric(fields.dNumDoc, CDC_FIELD_WIDTHS.dNumDoc, "dNumDoc"),
    padNumeric(String(fields.iTipCont), CDC_FIELD_WIDTHS.iTipCont, "iTipCont"),
    emissionDate(fields.dFeEmiDE),
    padNumeric(String(fields.iTipEmi), CDC_FIELD_WIDTHS.iTipEmi, "iTipEmi"),
    padNumeric(fields.dCodSeg, CDC_FIELD_WIDTHS.dCodSeg, "dCodSeg"),
  ].join("");

  const expected = Object.values(CDC_FIELD_WIDTHS).reduce((sum, width) => sum + width, 0);
  if (prefix.length !== expected) {
    throw new DteValidationError(
      "INVALID_CDC_FIELD",
      `The composed prefix is ${prefix.length} characters; the composition requires ${expected}.`
    );
  }

  const dDVId = String(computeCdcCheckDigit(prefix));
  return { cdc: `${prefix}${dDVId}`, dDVId, prefix };
}

/** `dFeEmiDE` is taken "solo el formato AAAAMMDD" — a full timestamp is accepted. */
function emissionDate(value: string): string {
  const dateOnly = value.includes("T") ? (value.split("T")[0] ?? "") : value;
  const digits = dateOnly.replaceAll("-", "");
  if (!/^[0-9]{8}$/.test(digits)) {
    throw new DteValidationError(
      "INVALID_CDC_FIELD",
      "dFeEmiDE must carry a date, as AAAAMMDD or as a fecHhmmss whose date part is taken."
    );
  }
  return digits;
}

/**
 * Left-pads a numeric field to its width, and refuses one that is already too
 * long rather than truncating it: a truncated identity is worse than a refusal.
 */
function padNumeric(value: string, width: number, field: string): string {
  if (!/^[0-9]+$/.test(value)) {
    throw new DteValidationError(
      "INVALID_CDC_FIELD",
      `${field} must be numeric to enter the CDC; the composition has no letters.`
    );
  }
  if (value.length > width) {
    throw new DteValidationError(
      "INVALID_CDC_FIELD",
      `${field} is ${value.length} characters and the composition allows ${width}.`
    );
  }
  return value.padStart(width, "0");
}
