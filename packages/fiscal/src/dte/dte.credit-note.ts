/**
 * NCE-001 — mapping a total credit note to a `DteRequest` (DEC-090).
 *
 * A Nota de Crédito Electrónica (`C002 = 5`) is the same document shape as the
 * factura it credits, with three differences the Manual Técnico v150 pins
 * (SIFEN-BASELINE §27):
 *
 * - `gDtipDE` opens with `gCamNCDE` (`E400`, rule 1450): the motive `iMotEmi` and
 *   its exact description `dDesMotEmi`.
 * - `gCamDEAsoc` (`H001`, rule 2400) appears exactly once (2415) and names the
 *   factura electrónica by its CDC (`H002 = 1`, `H004`).
 * - `D011 iTipTra` is NOT informed ("No informar si C002 ≠ 1 o 4").
 *
 * The items and totals are the credited invoice's own frozen snapshot: a total
 * credit returns every line at its original amounts, so `F014` equals the
 * factura's and rule 2417 (the notes may not exceed the factura) holds by
 * construction. Partial credit is out of scope (DEC-089).
 */

import {
  buildDteRequestFromInvoice,
  type DteMappingInput,
  type MappedDteRequest,
} from "./dte.mapper.js";
import { assertTcdc, CREDIT_NOTE_MOTIVE_DESCRIPTIONS, DteValidationError } from "./dte.rules.js";
import type { DteXmlElement } from "./dte.types.js";

/** `iTipDocAso = 1`, the only associated-document kind a credit note built here uses. */
export const ASSOCIATED_DOCUMENT_ELECTRONIC = 1 as const;

export interface CreditNoteMappingInput extends DteMappingInput {
  /** `E401 iMotEmi`, 1..8. */
  readonly motive: number;
  /** `H004 dCdCDERef`: the CDC of the APPROVED factura electrónica being credited. */
  readonly associatedCdc: string;
}

export function buildDteRequestFromCreditNote(input: CreditNoteMappingInput): MappedDteRequest {
  const description = CREDIT_NOTE_MOTIVE_DESCRIPTIONS[input.motive];
  if (description === undefined) {
    throw new DteValidationError(
      "INVALID_DOCUMENT_TYPE_GROUP",
      `E401 iMotEmi must be 1..8; received ${String(input.motive)}.`
    );
  }
  if (input.profile.timbrado.iTiDE !== 5) {
    throw new DteValidationError(
      "INVALID_DOCUMENT_TYPE_GROUP",
      "A credit note is built under a timbrado for document type 5."
    );
  }
  assertTcdc(input.associatedCdc);

  // D011: the profile's transaction type belongs to the factura, not the note.
  const { iTipTra: _iTipTra, dDesTipTra: _dDesTipTra, ...operation } = input.profile.operation;
  const mapped = buildDteRequestFromInvoice({
    ...input,
    profile: { ...input.profile, operation },
  });

  const note: DteXmlElement = {
    name: "gCamNCDE",
    children: [
      { name: "iMotEmi", value: String(input.motive) },
      { name: "dDesMotEmi", value: description },
    ],
  };
  const associated: readonly DteXmlElement[] = [
    { name: "iTipDocAso", value: String(ASSOCIATED_DOCUMENT_ELECTRONIC) },
    { name: "dDesTipDocAso", value: "Electrónico" },
    { name: "dCdCDERef", value: input.associatedCdc },
  ];

  return {
    totals: mapped.totals,
    request: {
      ...mapped.request,
      gDtipDE: [note, ...(mapped.request.gDtipDE ?? [])],
      gCamDEAsoc: [associated],
    },
  };
}
