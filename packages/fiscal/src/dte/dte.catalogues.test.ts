/**
 * FISC-011 — the description catalogues.
 *
 * The suite is written against the SOURCES rather than against the
 * implementation: the counts come from the XSD enumerations, the transaction
 * pairings come from the Manual's table, and the trap the two disagree about is
 * pinned explicitly so a positional mapping cannot creep back in.
 */

import { describe, expect, it } from "vitest";
import {
  DTE_DEPARTMENT_NAMES,
  DTE_DOCUMENT_TYPE_DESCRIPTIONS,
  DTE_EMISSION_TYPE_DESCRIPTIONS,
  DTE_TAX_TYPE_DESCRIPTIONS,
  DTE_TRANSACTION_TYPE_DESCRIPTIONS,
  DteCatalogueError,
  describeDepartment,
  describeDocumentType,
  describeEmissionType,
  describeTaxType,
  describeTransactionType,
} from "./dte.catalogues.js";

/**
 * `tdDesTiTran` from `DE_Types_v150.xsd`, verbatim: the ELEVEN descriptions the
 * schema admits. The Manual lists thirteen; codes 3 and 7 are the two it lists
 * and the XSD does not.
 */
const XSD_TD_DES_TI_TRAN = [
  "Venta de mercadería",
  "Prestación de servicios",
  "Venta de activo fijo",
  "Venta de divisas",
  "Compra de divisas",
  "Donación",
  "Anticipo",
  "Compra de productos",
  "Compra de servicios",
  "Venta de crédito fiscal",
  "Muestras médicas (Art. 3 RG 24/2014)",
] as const;

/** The failure code a call raises, which is the part a caller branches on. */
function failureOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    if (error instanceof DteCatalogueError) {
      return error.failure;
    }
    throw error;
  }
  throw new Error("expected the call to throw");
}

describe("the catalogues hold what the sources enumerate", () => {
  it("counts them as the schemas do", () => {
    expect(DTE_DOCUMENT_TYPE_DESCRIPTIONS).toHaveLength(7);
    expect(DTE_TAX_TYPE_DESCRIPTIONS).toHaveLength(5);
    expect(DTE_EMISSION_TYPE_DESCRIPTIONS).toHaveLength(2);
    expect(DTE_DEPARTMENT_NAMES).toHaveLength(20);
    // THIRTEEN, from the Manual, while the XSD enumerates eleven. See below.
    expect(DTE_TRANSACTION_TYPE_DESCRIPTIONS).toHaveLength(13);
  });

  it("keys every catalogue by its code, with no gaps or repeats", () => {
    for (const catalogue of [
      DTE_DOCUMENT_TYPE_DESCRIPTIONS,
      DTE_TAX_TYPE_DESCRIPTIONS,
      DTE_EMISSION_TYPE_DESCRIPTIONS,
      DTE_TRANSACTION_TYPE_DESCRIPTIONS,
      DTE_DEPARTMENT_NAMES,
    ]) {
      const codes = catalogue.map((entry) => entry.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes.every((code) => Number.isInteger(code))).toBe(true);
    }
  });

  it("numbers the transaction types 1..13 in order, one entry per code", () => {
    // The guard against the positional trap: entry i must carry code i + 1, so a
    // later edit cannot drop one and silently shift the rest.
    DTE_TRANSACTION_TYPE_DESCRIPTIONS.forEach((entry, index) => {
      expect(entry.code).toBe(index + 1);
    });
  });

  it("numbers the departments 1..20, which the schema enumerates in order", () => {
    DTE_DEPARTMENT_NAMES.forEach((entry, index) => {
      expect(entry.code).toBe(index + 1);
    });
    expect(describeDepartment(1)).toBe("CAPITAL");
    expect(describeDepartment(20)).toBe("NUEVA ASUNCION");
  });
});

describe("the Manual and the XSD disagree about two transaction types", () => {
  it("holds the eleven descriptions the schema admits", () => {
    // Codes 3 and 7 aside, the catalogue's descriptions ARE the XSD's list, in
    // the same order.
    const fromCatalogue = DTE_TRANSACTION_TYPE_DESCRIPTIONS.filter(
      (entry) => entry.code !== 3 && entry.code !== 7
    ).map((entry) => entry.description);
    expect(fromCatalogue).toEqual([...XSD_TD_DES_TI_TRAN]);
  });

  it("keeps the two the schema does not admit, because the Manual states them", () => {
    expect(describeTransactionType(3)).toBe("Mixto (Venta de mercadería y servicios)");
    expect(describeTransactionType(7)).toBe("Promoción o entrega de muestras");
    expect(XSD_TD_DES_TI_TRAN).not.toContain(describeTransactionType(3));
    expect(XSD_TD_DES_TI_TRAN).not.toContain(describeTransactionType(7));
  });

  it("is the reason a positional mapping would be wrong", () => {
    // The XSD's third entry is the description of code 4, not of code 3. If the
    // catalogue were built by position, code 3 would come back as this:
    expect(XSD_TD_DES_TI_TRAN[2]).toBe("Venta de activo fijo");
    expect(describeTransactionType(3)).not.toBe(XSD_TD_DES_TI_TRAN[2]);
    // And from code 4 upward the offset would compound.
    expect(describeTransactionType(4)).toBe(XSD_TD_DES_TI_TRAN[2]);
  });
});

describe("the pairs the sources state, and the two that are placed by elimination", () => {
  it("pairs the first code of each set with the description the fixture uses", () => {
    // The Manual's worked example emits these pairs; the fixture transcribes them.
    expect(describeDocumentType(1)).toBe("Factura electrónica");
    expect(describeTaxType(1)).toBe("IVA");
    expect(describeTransactionType(1)).toBe("Venta de mercadería");
    expect(describeEmissionType(1)).toBe("Normal");
    expect(describeEmissionType(2)).toBe("Contingencia");
  });

  it("states five document-type pairs and places two by elimination", () => {
    // The Manual's C002/C003 table gives 1, 4, 5, 6 and 7 outright. It also lists
    // 2, 3 and 8, all marked "(Futuro)", and NONE of those is in tiTiDE — so the
    // XSD's enum is the gate, not the Manual's table.
    expect(describeDocumentType(1)).toBe("Factura electrónica");
    expect(describeDocumentType(4)).toBe("Autofactura electrónica");
    expect(describeDocumentType(5)).toBe("Nota de crédito electrónica");
    expect(describeDocumentType(6)).toBe("Nota de débito electrónica");
    expect(describeDocumentType(7)).toBe("Nota de remisión electrónica");
    // 9 and 10 are in neither table: their descriptions exist only in tdDesTiDE,
    // and the five above take the first five entries, leaving these two.
    expect(describeDocumentType(9)).toBe("Boleta de venta electrónica");
    expect(describeDocumentType(10)).toBe("Boleta resimple electrónica");
  });

  it("refuses the document types the schema skips", () => {
    for (const code of [2, 3, 8]) {
      expect(failureOf(() => describeDocumentType(code))).toBe("UNKNOWN_CODE");
    }
    expect(describeDocumentType(10)).toBe("Boleta resimple electrónica");
  });
});

describe("an unknown code is refused rather than guessed", () => {
  it("names the code and the catalogue it consulted", () => {
    expect(() => describeTaxType(6)).toThrow(/6 is not a tax type/);
    expect(() => describeTaxType(6)).toThrow(/1, 2, 3, 4, 5/);
    expect(() => describeDepartment(21)).toThrow(/21 is not a department/);
  });

  it("distinguishes a code that is not an integer from one that is unknown", () => {
    expect(failureOf(() => describeDepartment(1.5))).toBe("INVALID_CODE");
    expect(() => describeDepartment(1.5)).toThrow(/is an integer code/);
    expect(failureOf(() => describeDepartment(21))).toBe("UNKNOWN_CODE");
  });
});
